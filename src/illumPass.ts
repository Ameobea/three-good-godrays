import { Pass, type Resizable } from 'postprocessing';
import * as THREE from 'three';

import GodraysFragmentShader from './godrays.frag';
import GodraysVertexShader from './godrays.vert';
import type { GodraysPassParams } from './index';

export const GODRAYS_RESOLUTION_SCALE = 1 / 2;

interface GodRaysDefines {
  IS_POINT_LIGHT?: string;
  IS_DIRECTIONAL_LIGHT?: string;
  USE_UNPACKED_DEPTH?: string;
}

class GodraysMaterial extends THREE.ShaderMaterial {
  constructor(light: THREE.PointLight | THREE.DirectionalLight) {
    const uniforms = {
      density: { value: 1 / 128 },
      maxDensity: { value: 0.5 },
      distanceAttenuation: { value: 2 },
      sceneDepth: { value: null },
      lightPos: { value: new THREE.Vector3(0, 0, 0) },
      cameraPos: { value: new THREE.Vector3(0, 0, 0) },
      resolution: { value: new THREE.Vector2(1, 1) },
      premultipliedLightCameraMatrix: { value: new THREE.Matrix4() },
      cameraProjectionMatrixInv: { value: new THREE.Matrix4() },
      cameraMatrixWorld: { value: new THREE.Matrix4() },
      shadowMap: { value: null },
      texelSizeY: { value: 1 },
      lightCameraNear: { value: 0.1 },
      lightCameraFar: { value: 1000 },
      near: { value: 0.1 },
      far: { value: 1000.0 },
      fNormals: { value: DIRECTIONS.map(() => new THREE.Vector3()) },
      fConstants: { value: DIRECTIONS.map(() => 0) },
      raymarchSteps: { value: 60 },
    };

    const defines: GodRaysDefines = {};
    if (light instanceof THREE.PointLight || (light as any).isPointLight) {
      defines.IS_POINT_LIGHT = '';
    } else if (light instanceof THREE.DirectionalLight || (light as any).isDirectionalLight) {
      defines.IS_DIRECTIONAL_LIGHT = '';
    }
    const threeVersion = +THREE.REVISION;
    if (threeVersion >= 182) {
      defines.USE_UNPACKED_DEPTH = '';
    }

    super({
      name: 'GodraysMaterial',
      uniforms,
      fragmentShader: GodraysFragmentShader,
      vertexShader: GodraysVertexShader,
      defines: defines as any,
    });

  }
}

const DIRECTIONS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];
const PLANES = DIRECTIONS.map(() => new THREE.Plane());
const SCRATCH_VECTOR = new THREE.Vector3();
const SCRATCH_FRUSTUM = new THREE.Frustum();
const SCRATCH_MAT4 = new THREE.Matrix4();

export interface GodraysIllumPassProps {
  light: THREE.PointLight | THREE.DirectionalLight;
  camera: THREE.PerspectiveCamera;
}

export class GodraysIllumPass extends Pass implements Resizable {
  private material: GodraysMaterial;
  private shadowMapSet = false;
  private props: GodraysIllumPassProps;
  private lastParams: GodraysPassParams;
  private lightWorldPos = new THREE.Vector3();
  /**
   * Tracks whether we need to copy the shadow map depth texture to avoid comparison mode issues.
   *
   * Three.js configures depth textures differently based on shadow map type:
   * - PCFShadowMap (default): Sets compareFunction to LessEqualCompare, requiring sampler2DShadow
   * - PCFSoftShadowMap/BasicShadowMap: Sets compareFunction to null, allowing regular sampler2D
   *
   * The godrays shader needs raw depth values for raymarching, so it uses sampler2D.
   * When PCFShadowMap is used, we copy the depth data to our own texture without comparison mode
   * using WebGL's blitFramebuffer, which copies at the GPU level without shader sampling.
   */
  private needsDepthCopy = false;
  private depthCopyTarget: THREE.WebGLRenderTarget | null = null;
  private originalShadowMap: THREE.DepthTexture | null = null;

  constructor(props: GodraysIllumPassProps, params: GodraysPassParams) {
    // Newer versions of postprocessing provide an `OrthographicCamera` by default to `Pass`, but
    // our shaders were written expecting a base `THREE.Camera`.
    super('GodraysPass', undefined, new THREE.Camera());

    this.props = props;
    this.lastParams = params;
    this.material = new GodraysMaterial(props.light);

    this.updateUniforms(props, params);

    this.fullscreenMaterial = this.material;
  }

  override setSize(width: number, height: number): void {
    this.material.uniforms.resolution.value.set(
      Math.ceil(width * GODRAYS_RESOLUTION_SCALE),
      Math.ceil(height * GODRAYS_RESOLUTION_SCALE)
    );
    this.material.uniforms.near.value = this.props.camera.near;
    this.material.uniforms.far.value = this.props.camera.far;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
    _deltaTime?: number | undefined,
    _stencilTest?: boolean | undefined
  ): void {
    if (!this.shadowMapSet && this.props.light.shadow.map?.texture) {
      this.updateUniforms(this.props, this.lastParams);
      this.shadowMapSet = true;
      this.checkForDepthCopy(renderer);
    }
    this.updateLightParams(this.props);

    if (this.needsDepthCopy && this.originalShadowMap && this.depthCopyTarget) {
      this.copyDepthTexture(renderer);
      this.material.uniforms.shadowMap.value = this.depthCopyTarget.depthTexture;
    }

    renderer.setRenderTarget(outputBuffer);
    renderer.render(this.scene, this.camera);

    // swap back the original shadow map if we did a depth copy
    if (this.needsDepthCopy && this.originalShadowMap) {
      this.material.uniforms.shadowMap.value = this.originalShadowMap;
    }
  }

  /**
   * Copy the shadow map depth texture to our own texture without comparison mode.
   * Uses blitFramebuffer for GPU-level copy without shader sampling.
   */
  private copyDepthTexture(renderer: THREE.WebGLRenderer): void {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const shadow = this.props.light.shadow;

    const shadowMapProps = renderer.properties.get(shadow.map!) as any;
    const srcFramebuffer = shadowMapProps.__webglFramebuffer;

    const copyTargetProps = renderer.properties.get(this.depthCopyTarget!) as any;
    let dstFramebuffer = copyTargetProps?.__webglFramebuffer;

    if (!dstFramebuffer) {
      renderer.setRenderTarget(this.depthCopyTarget);
      renderer.clear();
      renderer.setRenderTarget(null);
      const updatedProps = renderer.properties.get(this.depthCopyTarget!) as any;
      dstFramebuffer = updatedProps.__webglFramebuffer;
    }

    if (!srcFramebuffer || !dstFramebuffer) {
      return;
    }

    const width = shadow.map!.width;
    const height = shadow.map!.height;

    // copy depth from shadow map to our own depth texture
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFramebuffer);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);

    // Restore framebuffer state
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  /**
   * Check if the shadow map's depth texture has comparison mode enabled,
   * which requires copying the depth texture to avoid sampler type mismatch.
   *
   * This check is based on the actual compareFunction value rather than shadow map type,
   * making it robust against Three.js version differences:
   * - r182: PCFShadowMap has compareFunction set, PCFSoftShadowMap does not
   * - r183+: PCFSoftShadowMap is auto-converted to PCFShadowMap, so both have compareFunction set
   */
  private checkForDepthCopy(renderer: THREE.WebGLRenderer): void {
    const light = this.props.light;
    const isDirectionalOrSpot =
      light instanceof THREE.DirectionalLight ||
      (light as any).isDirectionalLight ||
      light instanceof THREE.SpotLight ||
      (light as any).isSpotLight;

    if (!isDirectionalOrSpot) {
      this.needsDepthCopy = false;
      return;
    }

    const depthTexture = light.shadow.map?.depthTexture as THREE.DepthTexture | undefined;

    // When compareFunction is set (not null), the texture requires `sampler2DShadow` in GLSL,
    // but our shader uses `sampler2D` to read raw depth values for raymarching.
    //
    // In that case, we need to copy the depth data to our own texture without comparison mode.
    const hasCompareFunction = depthTexture && depthTexture.compareFunction !== null;

    if (hasCompareFunction) {
      this.needsDepthCopy = true;
      this.originalShadowMap = depthTexture;

      const shadowMapSize = light.shadow.mapSize;
      this.depthCopyTarget = new THREE.WebGLRenderTarget(shadowMapSize.x, shadowMapSize.y);
      this.depthCopyTarget.depthTexture = new THREE.DepthTexture(
        shadowMapSize.x,
        shadowMapSize.y,
        THREE.UnsignedIntType
      );
      this.depthCopyTarget.depthTexture.format = THREE.DepthFormat;
      this.depthCopyTarget.depthTexture.compareFunction = null as any;
      this.depthCopyTarget.depthTexture.minFilter = THREE.NearestFilter;
      this.depthCopyTarget.depthTexture.magFilter = THREE.NearestFilter;
    } else {
      this.needsDepthCopy = false;
      this.originalShadowMap = null;
    }
  }

  override setDepthTexture(
    depthTexture: THREE.Texture,
    depthPacking?: THREE.DepthPackingStrategies | undefined
  ): void {
    this.material.uniforms.sceneDepth.value = depthTexture;
    if (depthPacking && depthPacking !== THREE.BasicDepthPacking) {
      throw new Error('Only BasicDepthPacking is supported');
    }
  }

  private updateLightParams({ light }: GodraysIllumPassProps) {
    light.getWorldPosition(this.lightWorldPos);

    const uniforms = this.material.uniforms;
    (uniforms.premultipliedLightCameraMatrix.value as THREE.Matrix4).multiplyMatrices(
      light.shadow.camera.projectionMatrix,
      light.shadow.camera.matrixWorldInverse
    );

    if (light instanceof THREE.PointLight || (light as any).isPointLight) {
      for (let i = 0; i < DIRECTIONS.length; i += 1) {
        const direction = DIRECTIONS[i];
        const plane = PLANES[i];

        SCRATCH_VECTOR.copy(light.position);
        SCRATCH_VECTOR.addScaledVector(direction, uniforms.lightCameraFar.value);
        plane.setFromNormalAndCoplanarPoint(direction, SCRATCH_VECTOR);

        uniforms.fNormals.value[i].copy(plane.normal);
        uniforms.fConstants.value[i] = plane.constant;
      }
    } else if (light instanceof THREE.DirectionalLight || (light as any).isDirectionalLight) {
      SCRATCH_MAT4.multiplyMatrices(
        light.shadow.camera.projectionMatrix,
        light.shadow.camera.matrixWorldInverse
      );
      SCRATCH_FRUSTUM.setFromProjectionMatrix(SCRATCH_MAT4);

      for (let planeIx = 0; planeIx < 6; planeIx += 1) {
        const plane = SCRATCH_FRUSTUM.planes[planeIx];
        uniforms.fNormals.value[planeIx].copy(plane.normal).multiplyScalar(-1);
        uniforms.fConstants.value[planeIx] = plane.constant * -1;
      }
    }
  }

  public updateUniforms({ light, camera }: GodraysIllumPassProps, params: GodraysPassParams): void {
    const shadow = light.shadow;
    if (!shadow) {
      throw new Error('Light used for godrays must have shadow');
    }

    let shadowMap = shadow.map?.texture ?? null;
    if (
      (light instanceof THREE.DirectionalLight || (light as any).isDirectionalLight) &&
      shadow.map?.depthTexture
    ) {
      shadowMap = shadow.map.depthTexture;
    }

    const mapSize = shadow.map?.height ?? 1;

    if (shadowMap && (shadowMap as any).isCubeTexture) {
      if (this.material.defines.USE_CUBE_SHADOWMAP === undefined) {
        this.material.defines.USE_CUBE_SHADOWMAP = '';
        this.material.needsUpdate = true;
      }
    } else {
      if (this.material.defines.USE_CUBE_SHADOWMAP !== undefined) {
        delete this.material.defines.USE_CUBE_SHADOWMAP;
        this.material.needsUpdate = true;
      }
    }

    const uniforms = this.material.uniforms;
    uniforms.density.value = params.density;
    uniforms.maxDensity.value = params.maxDensity;
    uniforms.lightPos.value = this.lightWorldPos;
    uniforms.cameraPos.value = camera.position;
    uniforms.cameraProjectionMatrixInv.value = camera.projectionMatrixInverse;
    uniforms.cameraMatrixWorld.value = camera.matrixWorld;
    uniforms.shadowMap.value = shadowMap;
    uniforms.texelSizeY.value = 1 / (mapSize * 2);
    uniforms.lightCameraNear.value = shadow?.camera.near ?? 0.1;
    uniforms.lightCameraFar.value = shadow?.camera.far ?? 1000;
    uniforms.near.value = camera.near;
    uniforms.far.value = camera.far;
    uniforms.density.value = params.density;
    uniforms.maxDensity.value = params.maxDensity;
    uniforms.distanceAttenuation.value = params.distanceAttenuation;
    uniforms.raymarchSteps.value = params.raymarchSteps;
  }
}
