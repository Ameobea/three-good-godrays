/*
 * Code taken + adapted from this demo: https://n8python.github.io/goodGodRays/
 * By: https://github.com/n8python
 *
 * With cleanup and minor changes
 */
import { type Disposable, KernelSize, Pass } from 'postprocessing';
import * as THREE from 'three';

import { BilateralFilterPass, GODRAYS_BLUR_RESOLUTION_SCALE } from './bilateralFilter';
import { GodraysCompositorMaterial, GodraysCompositorPass } from './compositorPass';
import { GodraysIllumPass, type GodraysIllumPassProps } from './illumPass';

export enum GodraysUpsampleQuality {
  /**
   * 2x2 neighborhood (4 texture taps). Fast with good edge preservation.
   */
  LOW = 0,
  /**
   * 4x4 neighborhood (16 texture taps). Better quality, especially for diagonal edges.
   */
  HIGH = 1,
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

export interface AdaptiveStepsParams {
  stepSize: number;
  minSteps?: number;
  maxSteps?: number;
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
   * Default: true
   */
  blur: boolean | Partial<GodraysBlurParams>;
  gammaCorrection: boolean;
  /**
   * Resolution scale for the godrays render target, relative to the full screen resolution.
   * Lower values improve performance at the cost of quality. The joint bilateral upsampling
   * preserves sharp edges even at low resolutions.
   *
   * - `1.0` — Full resolution. Best quality, highest cost.
   * - `0.5` — Half resolution (default). Good balance of quality and performance.
   * - `0.25` — Quarter resolution. Fast, but may lose fine detail.
   *
   * Default: `0.5`
   */
  resolutionScale: number;
  /**
   * Quality level for the depth-aware upsampling of the low-resolution godrays texture.
   *
   * Uses joint bilateral upsampling (JBU) to prevent godrays from bleeding across depth edges.
   * Higher quality uses a larger sample neighborhood for smoother results, especially along diagonal edges.
   *
   * - `GodraysUpsampleQuality.LOW` — 2x2 neighborhood (4 texture taps). Fast with good edge preservation.
   * - `GodraysUpsampleQuality.HIGH` — 4x4 neighborhood (16 texture taps). Better quality.
   *
   * Default: `GodraysUpsampleQuality.HIGH`
   */
  upsampleQuality: GodraysUpsampleQuality;
  /**
   * Adaptive step count based on ray length / step size.  Uses per-pixel step count with shadow map texel size
   * as an additional floor.
   *
   * Cannot be used together with an explicit `raymarchSteps` value.
   */
  adaptiveSteps?: AdaptiveStepsParams;
  /**
   * When enabled, renders a heatmap of raymarching step counts instead of godrays.
   * Uses a fixed scale of 0–150 steps so that comparisons between configurations are absolute.
   *
   * Implemented via a shader define, so there is zero runtime cost when disabled.
   *
   * Default: false
   */
  debugSteps?: boolean;
}

const defaultParams: GodraysPassParams = {
  density: 1 / 128,
  maxDensity: 0.5,
  distanceAttenuation: 2,
  color: new THREE.Color(0xffffff),
  raymarchSteps: 60,
  blur: true,
  gammaCorrection: true,
  resolutionScale: 0.5,
  upsampleQuality: GodraysUpsampleQuality.HIGH,
};

const populateParams = (partialParams: Partial<GodraysPassParams>): GodraysPassParams => {
  if ('raymarchSteps' in partialParams && 'adaptiveSteps' in partialParams) {
    throw new Error('Cannot specify both raymarchSteps and adaptiveSteps');
  }
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
  private props: GodraysIllumPassProps;
  private depthTexture: THREE.Texture | null = null;
  private depthPacking: THREE.DepthPackingStrategies | null | undefined = null;
  private lastParams: GodraysPassParams;
  private lastWidth = 1;
  private lastHeight = 1;

  private godraysRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    generateMipmaps: false,
  });
  private illumPass: GodraysIllumPass;
  private enableBlurPass = true;
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
   * const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
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
    // Newer versions of postprocessing provide an `OrthographicCamera` by default to `Pass`, but
    // our shaders were written expecting a base `THREE.Camera`.
    super('GodraysPass', undefined, new THREE.Camera());

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
      color: params.color,
      camera,
      gammaCorrection: params.gammaCorrection,
      upsampleQuality: params.upsampleQuality,
    });
    this.compositorPass.needsDepthTexture = true;

    // Indicate to the composer that this pass needs depth information from the previous pass
    this.needsDepthTexture = true;

    this.setParams(partialParams);
  }

  /**
   * Updates the parameters used for the godrays effect.  Will use default values for any parameters not specified.
   */
  public setParams(partialParams: Partial<GodraysPassParams>): void {
    const oldScale = this.lastParams.resolutionScale;
    const params = populateParams(partialParams);
    this.lastParams = params;
    this.illumPass.updateUniforms(this.props, params);
    this.compositorPass.updateUniforms(params);
    this.compositorPass.updateUpsampleQuality(params.upsampleQuality);
    this.compositorPass.updateDebugSteps(!!params.debugSteps);

    if (params.resolutionScale !== oldScale) {
      this.setSize(this.lastWidth, this.lastHeight);
    }

    this.enableBlurPass = !!params.blur;
    if (params.blur && this.blurPass) {
      const blurParams = populateGodraysBlurParams(params.blur);

      if (this.blurPass.material.defines.KSIZE_ENUM !== blurParams.kernelSize) {
        this.blurPass.dispose();
        this.maybeInitBlur(
          this.godraysRenderTarget.texture as THREE.Texture<{ width: number; height: number }>
        );
      }

      this.blurPass.updateUniforms(blurParams);
      this.blurPass.updateDebugSteps(!!params.debugSteps);
    }
  }

  private maybeInitBlur(input: THREE.Texture<{ width: number; height: number }>) {
    if (!this.blurPass) {
      this.blurPass = new BilateralFilterPass(input);
      const blurParams = populateGodraysBlurParams(this.lastParams.blur);
      this.blurPass.updateUniforms(blurParams);
      this.blurPass.updateDebugSteps(!!this.lastParams.debugSteps);
      if (this.depthTexture) {
        this.blurPass.setDepthTexture(this.depthTexture, this.depthPacking ?? undefined);
      }
    }
    if (!this.blurRenderTarget) {
      this.blurRenderTarget = new THREE.WebGLRenderTarget(
        Math.ceil(this.godraysRenderTarget.width * GODRAYS_BLUR_RESOLUTION_SCALE),
        Math.ceil(this.godraysRenderTarget.height * GODRAYS_BLUR_RESOLUTION_SCALE),
        {
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          format: THREE.RGBAFormat,
          type: THREE.HalfFloatType,
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
      this.maybeInitBlur(
        this.godraysRenderTarget.texture as THREE.Texture<{ width: number; height: number }>
      );

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
    this.lastWidth = width;
    this.lastHeight = height;
    const scale = this.lastParams.resolutionScale;
    const godraysWidth = Math.ceil(width * scale);
    const godraysHeight = Math.ceil(height * scale);

    this.godraysRenderTarget.setSize(godraysWidth, godraysHeight);
    this.illumPass.setSize(godraysWidth, godraysHeight);
    this.compositorPass.setSize(width, height);
    this.compositorPass.setGodraysResolution(godraysWidth, godraysHeight);
    this.blurPass?.setSize(godraysWidth, godraysHeight);
    this.blurRenderTarget?.setSize(
      Math.ceil(godraysWidth * GODRAYS_BLUR_RESOLUTION_SCALE),
      Math.ceil(godraysHeight * GODRAYS_BLUR_RESOLUTION_SCALE)
    );
  }

  override dispose(): void {
    this.godraysRenderTarget.dispose();
    this.illumPass.dispose();
    this.compositorPass.dispose();
    this.blurPass?.dispose();
    super.dispose();
  }
}
