import { Pass, Resizable } from 'postprocessing';
import * as THREE from 'three';

import { getBlueNoiseTexture } from './bluenoise';
import GodraysFragmentShader from './godrays.frag';
import GodraysVertexShader from './godrays.vert';
import type { GodraysPassParams } from './index';

export const GODRAYS_RESOLUTION_SCALE = 1 / 2;

interface GodRaysDefines {
  IS_POINT_LIGHT?: string;
  IS_DIRECTIONAL_LIGHT?: string;
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
      blueNoise: { value: null as THREE.Texture | null },
      noiseResolution: { value: new THREE.Vector2(1, 1) },
      fNormals: { value: [] },
      fConstants: { value: [] },
      raymarchSteps: { value: 60 },
    };

    const defines: GodRaysDefines = {};
    if (light instanceof THREE.PointLight || (light as any).isPointLight) {
      defines.IS_POINT_LIGHT = '';
    } else if (light instanceof THREE.DirectionalLight || (light as any).isDirectionalLight) {
      defines.IS_DIRECTIONAL_LIGHT = '';
    }

    super({
      name: 'GodraysMaterial',
      uniforms,
      fragmentShader: GodraysFragmentShader,
      vertexShader: GodraysVertexShader,
      defines,
    });

    getBlueNoiseTexture().then(blueNoiseTexture => {
      uniforms.blueNoise.value = blueNoiseTexture;
      uniforms.noiseResolution.value.set(
        blueNoiseTexture.image.width,
        blueNoiseTexture.image.height
      );
    });
  }
}

export interface GodraysIllumPassProps {
  light: THREE.PointLight | THREE.DirectionalLight;
  camera: THREE.Camera;
}

export class GodraysIllumPass extends Pass implements Resizable {
  private material: GodraysMaterial;
  private shadowMapSet = false;
  private props: GodraysIllumPassProps;
  private lastParams: GodraysPassParams;
  private lightWorldPos = new THREE.Vector3();

  constructor(props: GodraysIllumPassProps, params: GodraysPassParams) {
    super('GodraysPass');

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
    }
    this.updateLightPosition(this.props);
    renderer.setRenderTarget(outputBuffer);
    renderer.render(this.scene, this.camera);
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

  private updateLightPosition({ light }: GodraysIllumPassProps) {
    light.getWorldPosition(this.lightWorldPos);
  }

  public updateUniforms({ light, camera }: GodraysIllumPassProps, params: GodraysPassParams): void {
    const shadow = light.shadow;
    if (!shadow) {
      throw new Error('Light used for godrays must have shadow');
    }

    const shadowMap = shadow.map?.texture ?? null;
    const mapSize = shadow.map?.height ?? 1;

    const uniforms = this.material.uniforms;
    uniforms.density.value = params.density;
    uniforms.maxDensity.value = params.maxDensity;
    uniforms.lightPos.value = this.lightWorldPos;
    uniforms.cameraPos.value = camera.position;
    (uniforms.premultipliedLightCameraMatrix.value as THREE.Matrix4).multiplyMatrices(
      light.shadow.camera.projectionMatrix,
      light.shadow.camera.matrixWorldInverse
    );
    uniforms.cameraProjectionMatrixInv.value = camera.projectionMatrixInverse;
    uniforms.cameraMatrixWorld.value = camera.matrixWorld;
    uniforms.shadowMap.value = shadowMap;
    uniforms.texelSizeY.value = 1 / (mapSize * 2);
    uniforms.lightCameraNear.value = shadow?.camera.near ?? 0.1;
    uniforms.lightCameraFar.value = shadow?.camera.far ?? 1000;
    uniforms.density.value = params.density;
    uniforms.maxDensity.value = params.maxDensity;
    uniforms.distanceAttenuation.value = params.distanceAttenuation;
    uniforms.raymarchSteps.value = params.raymarchSteps;

    if (light instanceof THREE.PointLight || (light as any).isPointLight) {
      const planes = [];
      const directions = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, -1),
      ];
      for (const direction of directions) {
        planes.push(
          new THREE.Plane().setFromNormalAndCoplanarPoint(
            direction,
            light.position
              .clone()
              .add(direction.clone().multiplyScalar(uniforms.lightCameraFar.value))
          )
        );
      }
      uniforms.fNormals.value = planes.map(x => x.normal.clone());
      uniforms.fConstants.value = planes.map(x => x.constant);
    } else if (light instanceof THREE.DirectionalLight || (light as any).isDirectionalLight) {
      const frustum = new THREE.Frustum();
      frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
          light.shadow.camera.projectionMatrix,
          light.shadow.camera.matrixWorldInverse
        )
      );
      uniforms.fNormals.value = frustum.planes.map(x => x.normal.clone().multiplyScalar(-1));
      uniforms.fConstants.value = frustum.planes.map(x => x.constant * -1);
    }
  }
}
