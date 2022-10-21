/*
 * Code taken + adapted from this demo: https://n8python.github.io/goodGodRays/
 * By: https://github.com/n8python
 *
 * With cleanup and minor changes
 */
import { Disposable, KernelSize, Pass, Resizable } from 'postprocessing';
import * as THREE from 'three';
import type { PerspectiveCamera } from 'three';

import BilateralFilterFragmentShader from './bilateralFilter.frag';
import { BlueNoiseTextureDataURI } from './bluenoise';
import GodraysCompositorFragmentShader from './compositor.frag';
import GodraysCompositorVertexShader from './compositor.vert';
import GodraysFragmentShader from './godrays.frag';
import GodraysVertexShader from './godrays.vert';

const GODRAYS_RESOLUTION_SCALE = 1 / 2;
const GODRAYS_BLUR_RESOLUTION_SCALE = 1;

const getBlueNoiseTexture = async (): Promise<THREE.Texture> => {
  const textureLoader = new THREE.TextureLoader();
  const blueNoiseTexture = await textureLoader.loadAsync(BlueNoiseTextureDataURI);

  blueNoiseTexture.wrapS = THREE.RepeatWrapping;
  blueNoiseTexture.wrapT = THREE.RepeatWrapping;
  blueNoiseTexture.magFilter = THREE.NearestFilter;
  blueNoiseTexture.minFilter = THREE.NearestFilter;
  blueNoiseTexture.generateMipmaps = false;
  return blueNoiseTexture;
};

class BilateralFilterMaterial extends THREE.ShaderMaterial {
  constructor(input: THREE.Texture) {
    super({
      uniforms: {
        tInput: { value: input },
        resolution: {
          value: new THREE.Vector2(
            input.image.width * GODRAYS_BLUR_RESOLUTION_SCALE,
            input.image.height * GODRAYS_BLUR_RESOLUTION_SCALE
          ),
        },
        bSigma: { value: 0 },
      },
      defines: {
        KSIZE_ENUM: KernelSize.SMALL,
      },
      vertexShader: GodraysCompositorVertexShader,
      fragmentShader: BilateralFilterFragmentShader,
    });
  }
}

class BilateralFilterPass extends Pass implements Resizable, Disposable {
  public material: BilateralFilterMaterial;

  constructor(input: THREE.Texture) {
    super('BilateralFilterPass');
    this.needsSwap = false;
    this.material = new BilateralFilterMaterial(input);

    this.fullscreenMaterial = this.material;
  }

  override setSize(width: number, height: number): void {
    this.material.uniforms.resolution.value.set(width, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
    _deltaTime?: number | undefined,
    _stencilTest?: boolean | undefined
  ): void {
    renderer.setRenderTarget(outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  public updateUniforms(params: GodraysBlurParams) {
    this.material.uniforms.bSigma.value = params.variance;
    this.material.defines.KSIZE_ENUM = params.kernelSize;
  }

  public override   dispose() {
    this.material.dispose();
    super.dispose();
  }
}

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
      lightCameraProjectionMatrix: { value: new THREE.Matrix4() },
      lightCameraMatrixWorldInverse: { value: new THREE.Matrix4() },
      cameraProjectionMatrixInv: { value: new THREE.Matrix4() },
      cameraMatrixWorld: { value: new THREE.Matrix4() },
      shadowMap: { value: null },
      mapSize: { value: 1 },
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

class GodraysIllumPass extends Pass implements Resizable {
  private material: GodraysMaterial;
  private shadowMapSet = false;
  private props: GodraysPassProps;
  private lastParams: GodraysPassParams;

  constructor(props: GodraysPassProps, params: GodraysPassParams) {
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

  public updateUniforms({ light, camera }: GodraysPassProps, params: GodraysPassParams): void {
    const shadow = light.shadow;
    if (!shadow) {
      throw new Error('Light used for godrays must have shadow');
    }

    const shadowMap = shadow.map?.texture ?? null;
    const mapSize = shadow.map?.height ?? 1;

    const uniforms = this.material.uniforms;
    uniforms.density.value = params.density;
    uniforms.maxDensity.value = params.maxDensity;
    uniforms.lightPos.value = light.position;
    uniforms.cameraPos.value = camera.position;
    uniforms.lightCameraProjectionMatrix.value = light.shadow.camera.projectionMatrix;
    uniforms.lightCameraMatrixWorldInverse.value = light.shadow.camera.matrixWorldInverse;
    uniforms.cameraProjectionMatrixInv.value = camera.projectionMatrixInverse;
    uniforms.cameraMatrixWorld.value = camera.matrixWorld;
    uniforms.shadowMap.value = shadowMap;
    uniforms.mapSize.value = mapSize;
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

interface GodraysCompositorMaterialProps {
  godrays: THREE.Texture;
  edgeStrength: number;
  edgeRadius: number;
  color: THREE.Color;
  camera: THREE.PerspectiveCamera;
}

class GodraysCompositorMaterial extends THREE.ShaderMaterial implements Resizable {
  constructor({
    godrays,
    edgeStrength,
    edgeRadius,
    color,
    camera,
  }: GodraysCompositorMaterialProps) {
    const uniforms = {
      godrays: { value: godrays },
      sceneDiffuse: { value: null },
      sceneDepth: { value: null },
      edgeStrength: { value: edgeStrength },
      edgeRadius: { value: edgeRadius },
      near: { value: 0.1 },
      far: { value: 1000.0 },
      color: { value: color },
      resolution: { value: new THREE.Vector2(1, 1) },
    };

    super({
      name: 'GodraysCompositorMaterial',
      uniforms,
      depthWrite: false,
      depthTest: false,
      fragmentShader: GodraysCompositorFragmentShader,
      vertexShader: GodraysCompositorVertexShader,
    });

    this.updateUniforms(edgeStrength, edgeRadius, color, camera.near, camera.far);
  }

  public updateUniforms(
    edgeStrength: number,
    edgeRadius: number,
    color: THREE.Color,
    near: number,
    far: number
  ): void {
    this.uniforms.edgeStrength.value = edgeStrength;
    this.uniforms.edgeRadius.value = edgeRadius;
    this.uniforms.color.value = color;
    this.uniforms.near.value = near;
    this.uniforms.far.value = far;
  }

  setSize(width: number, height: number): void {
    this.uniforms.resolution.value.set(width, height);
  }
}

class GodraysCompositorPass extends Pass {
  sceneCamera: PerspectiveCamera;
  constructor(props: GodraysCompositorMaterialProps) {
    super('GodraysCompositorPass');
    this.fullscreenMaterial = new GodraysCompositorMaterial(props);
    this.sceneCamera = props.camera;
  }

  public updateUniforms(params: GodraysPassParams): void {
    (this.fullscreenMaterial as GodraysCompositorMaterial).updateUniforms(
      params.edgeStrength,
      params.edgeRadius,
      params.color,
      this.sceneCamera.near,
      this.sceneCamera.far
    );
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget | null,
    _deltaTime?: number | undefined,
    _stencilTest?: boolean | undefined
  ): void {
    (this.fullscreenMaterial as GodraysCompositorMaterial).uniforms.sceneDiffuse.value =
      inputBuffer.texture;
    renderer.setRenderTarget(outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override setDepthTexture(
    depthTexture: THREE.Texture,
    depthPacking?: THREE.DepthPackingStrategies | undefined
  ): void {
    if (depthPacking && depthPacking !== THREE.BasicDepthPacking) {
      throw new Error('Only BasicDepthPacking is supported');
    }
    (this.fullscreenMaterial as GodraysCompositorMaterial).uniforms.sceneDepth.value = depthTexture;
  }

  override setSize(width: number, height: number): void {
    (this.fullscreenMaterial as GodraysCompositorMaterial).setSize(width, height);
  }
}

interface GodraysPassProps {
  light: THREE.PointLight | THREE.DirectionalLight;
  camera: THREE.Camera;
}

export interface GodraysBlurParams {
  /**
   * The sigma factor used by the bilateral filter for the blur.  Higher values result in more blur, but
   * can cause artifacts.
   *
   * Default: 0.1
   */
  variance: number;
  /**
   * The kernel size for the bilateral filter.  Higher values blur more neighboring pixels and can smooth over higher amounts of noise,
   * but require exponentially more texture samples and thus can be slower.
   *
   * Default: `KernelSize.SMALL`
   */
  kernelSize: KernelSize;
}

export interface GodraysPassParams {
  /**
   * The rate of accumulation for the godrays.  Higher values roughly equate to more humid air/denser fog.
   *
   * Default: 1 / 128
   */
  density: number;
  /**
   * The maximum density of the godrays.  Limits the maximum brightness of the godrays.
   *
   * Default: 0.5
   */
  maxDensity: number;
  /**
   * Default: 2
   */
  edgeStrength: number;
  /**
   * Edge radius used for depth-aware upsampling of the godrays.  Higher values can yield better edge quality at the cost of performance, as
   * each level higher of this requires two additional texture samples.
   *
   * Default: 2
   */
  edgeRadius: number;
  /**
   * Higher values decrease the accumulation of godrays the further away they are from the light source.
   *
   * Default: 2
   */
  distanceAttenuation: number;
  /**
   * The color of the godrays.
   *
   * Default: `new THREE.Color(0xffffff)`
   */
  color: THREE.Color;
  /**
   * The number of raymarching steps to take per pixel.  Higher values increase the quality of the godrays at the cost of performance.
   *
   * Default: 60
   */
  raymarchSteps: number;
  /**
   * Whether or not to apply a bilateral blur to the godrays.  This can be used to reduce artifacts that can occur when using a low number of raymarching steps.
   *
   * It costs a bit of extra performance, but can allow for a lower number of raymarching steps to be used with similar quality.
   *
   * Default: false
   */
  blur: boolean | Partial<GodraysBlurParams>;
}

const defaultParams: GodraysPassParams = {
  density: 1 / 128,
  maxDensity: 0.5,
  edgeStrength: 2,
  edgeRadius: 2,
  distanceAttenuation: 2,
  color: new THREE.Color(0xffffff),
  raymarchSteps: 60,
  blur: false,
};

const populateParams = (partialParams: Partial<GodraysPassParams>): GodraysPassParams => {
  return {
    ...defaultParams,
    ...partialParams,
    color: new THREE.Color(partialParams.color ?? defaultParams.color),
  };
};

const defaultGodraysBlurParams: GodraysBlurParams = {
  variance: 0.1,
  kernelSize: KernelSize.SMALL,
};

const populateGodraysBlurParams = (
  blur: boolean | Partial<GodraysBlurParams>
): GodraysBlurParams => {
  if (typeof blur === 'boolean') {
    return { ...defaultGodraysBlurParams };
  }
  return { ...defaultGodraysBlurParams, ...blur };
};

export class GodraysPass extends Pass implements Disposable {
  private props: GodraysPassProps;
  private depthTexture: THREE.Texture | null = null;
  private depthPacking: THREE.DepthPackingStrategies | null | undefined = null;
  private lastParams: GodraysPassParams;

  private godraysRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
  });
  private illumPass: GodraysIllumPass;
  private enableBlurPass = false;
  private blurPass: BilateralFilterPass | null = null;
  private blurRenderTarget: THREE.WebGLRenderTarget | null = null;
  private compositorPass: GodraysCompositorPass;

  /**
   * Constructs a new GodraysPass.  Casts godrays from a point light source.  Add to your scene's composer like this:
   *
   * ```ts
   * import { EffectComposer, RenderPass } from 'postprocessing';
   * import { GodraysPass } from 'three-good-godrays';
   *
   * const composer = new EffectComposer(renderer);
   * const renderPass = new RenderPass(scene, camera);
   * renderPass.renderToScreen = false;
   * composer.addPass(renderPass);
   *
   * const godraysPass = new GodraysPass(pointLight, camera);
   * godraysPass.renderToScreen = true;
   * composer.addPass(godraysPass);
   *
   * function animate() {
   *   composer.render(scene, camera);
   * }
   * ```
   *
   * @param light The light source to use for the godrays.
   * @param camera The camera used to render the scene.
   * @param partialParams The parameters to use for the godrays effect.  Will use default values for any parameters not specified.
   */
  constructor(
    light: THREE.PointLight | THREE.DirectionalLight,
    camera: THREE.PerspectiveCamera,
    partialParams: Partial<GodraysPassParams> = {}
  ) {
    super('GodraysPass');

    this.props = {
      light: light,
      camera,
    };
    const params = populateParams(partialParams);
    this.lastParams = params;

    this.illumPass = new GodraysIllumPass(this.props, params);
    this.illumPass.needsDepthTexture = true;

    this.compositorPass = new GodraysCompositorPass({
      godrays: this.godraysRenderTarget.texture,
      edgeStrength: params.edgeStrength,
      edgeRadius: params.edgeRadius,
      color: params.color,
      camera,
    });
    this.compositorPass.needsDepthTexture = true;

    // Indicate to the composer that this pass needs depth information from the previous pass
    this.needsDepthTexture = true;

    this.setParams(params);
  }

  /**
   * Updates the parameters used for the godrays effect.  Will use default values for any parameters not specified.
   */
  public setParams(partialParams: Partial<GodraysPassParams>): void {
    const params = populateParams(partialParams);
    this.lastParams = params;
    this.illumPass.updateUniforms(this.props, params);
    this.compositorPass.updateUniforms(params);

    this.enableBlurPass = !!params.blur;
    if (params.blur && this.blurPass) {
      const blurParams = populateGodraysBlurParams(params.blur);

      if (this.blurPass.material.defines.KSIZE_ENUM !== blurParams.kernelSize) {
        this.blurPass.dispose();
        this.maybeInitBlur(this.godraysRenderTarget.texture);
      }

      this.blurPass.updateUniforms(blurParams);
    }
  }

  private maybeInitBlur(input: THREE.Texture) {
    if (!this.blurPass) {
      this.blurPass = new BilateralFilterPass(input);
      const blurParams = populateGodraysBlurParams(this.lastParams.blur);
      this.blurPass.updateUniforms(blurParams);
      if (this.depthTexture) {
        this.blurPass.setDepthTexture(this.depthTexture, this.depthPacking ?? undefined);
      }
    }
    if (!this.blurRenderTarget) {
      this.blurRenderTarget = new THREE.WebGLRenderTarget(
        Math.ceil(this.godraysRenderTarget.width * GODRAYS_BLUR_RESOLUTION_SCALE),
        Math.ceil(this.godraysRenderTarget.height * GODRAYS_BLUR_RESOLUTION_SCALE),
        {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          generateMipmaps: false,
        }
      );
    }
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
    _deltaTime?: number | undefined,
    _stencilTest?: boolean | undefined
  ): void {
    this.illumPass.render(renderer, inputBuffer, this.godraysRenderTarget);

    if (this.enableBlurPass) {
      this.maybeInitBlur(this.godraysRenderTarget.texture);

      this.blurPass!.render(renderer, this.godraysRenderTarget, this.blurRenderTarget!);
      (this.compositorPass.fullscreenMaterial as GodraysCompositorMaterial).uniforms.godrays.value =
        this.blurRenderTarget!.texture;
    } else {
      (this.compositorPass.fullscreenMaterial as GodraysCompositorMaterial).uniforms.godrays.value =
        this.godraysRenderTarget.texture;
    }

    this.compositorPass.render(renderer, inputBuffer, this.renderToScreen ? null : outputBuffer);
  }

  override setDepthTexture(
    depthTexture: THREE.Texture,
    depthPacking?: THREE.DepthPackingStrategies | undefined
  ): void {
    this.illumPass.setDepthTexture(depthTexture, depthPacking);
    this.compositorPass.setDepthTexture(depthTexture, depthPacking);
    this.depthTexture = depthTexture;
    this.depthPacking = depthPacking;
  }

  override setSize(width: number, height: number): void {
    this.godraysRenderTarget.setSize(
      Math.ceil(width * GODRAYS_RESOLUTION_SCALE),
      Math.ceil(height * GODRAYS_RESOLUTION_SCALE)
    );
    this.illumPass.setSize(width, height);
    this.compositorPass.setSize(width, height);
    this.blurPass?.setSize(
      Math.ceil(width * GODRAYS_RESOLUTION_SCALE),
      Math.ceil(height * GODRAYS_RESOLUTION_SCALE)
    );
    this.blurRenderTarget?.setSize(
      Math.ceil(width * GODRAYS_RESOLUTION_SCALE * GODRAYS_BLUR_RESOLUTION_SCALE),
      Math.ceil(height * GODRAYS_RESOLUTION_SCALE * GODRAYS_BLUR_RESOLUTION_SCALE)
    );
  }

  override dispose(): void {
    this.godraysRenderTarget.dispose();
    this.illumPass.dispose();
    this.compositorPass.dispose();
    this.blurPass?.dispose;
    super.dispose();
  }
}
