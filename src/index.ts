/*
 * Code taken + adapted from this demo: https://n8python.github.io/goodGodRays/
 * By: https://github.com/n8python
 *
 * With cleanup and minor changes
 */
import { Disposable, KernelSize, Pass } from 'postprocessing';
import * as THREE from 'three';

import { BilateralFilterPass, GODRAYS_BLUR_RESOLUTION_SCALE } from './bilateralFilter';
import { GodraysCompositorMaterial, GodraysCompositorPass } from './compositorPass';
import { GODRAYS_RESOLUTION_SCALE, GodraysIllumPass, GodraysIllumPassProps } from './illumPass';

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
  private props: GodraysIllumPassProps;
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
