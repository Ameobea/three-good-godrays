import { Pass, type Resizable } from 'postprocessing';
import * as THREE from 'three';
import type { PerspectiveCamera } from 'three';

import GodraysCompositorFragmentShader from './compositor.frag';
import GodraysCompositorVertexShader from './compositor.vert';
import type { GodraysPassParams, GodraysUpsampleQuality } from './index';

interface GodraysCompositorMaterialProps {
  godrays: THREE.Texture;
  color: THREE.Color;
  camera: THREE.PerspectiveCamera;
  gammaCorrection: boolean;
  upsampleQuality: GodraysUpsampleQuality;
}

export class GodraysCompositorMaterial extends THREE.ShaderMaterial implements Resizable {
  constructor({
    godrays,
    color,
    camera,
    gammaCorrection,
    upsampleQuality,
  }: GodraysCompositorMaterialProps) {
    const uniforms = {
      godrays: { value: godrays },
      sceneDiffuse: { value: null },
      sceneDepth: { value: null },
      near: { value: 0.1 },
      far: { value: 1000.0 },
      color: { value: color },
      resolution: { value: new THREE.Vector2(1, 1) },
      godraysResolution: { value: new THREE.Vector2(1, 1) },
      gammaCorrection: { value: 1 },
    };

    const jbuExtent = upsampleQuality >= 1 ? 1 : 0;
    const jbuSpatialSigma = jbuExtent === 1 ? 1.0 : 0.5;

    super({
      name: 'GodraysCompositorMaterial',
      uniforms,
      depthWrite: false,
      depthTest: false,
      fragmentShader: GodraysCompositorFragmentShader,
      vertexShader: GodraysCompositorVertexShader,
      defines: {
        JBU_EXTENT: String(jbuExtent),
        JBU_SPATIAL_SIGMA: jbuSpatialSigma.toFixed(1),
        JBU_DEPTH_SIGMA: '0.02',
      },
    });

    this.updateUniforms(color, gammaCorrection, camera.near, camera.far);
  }

  public updateUniforms(
    color: THREE.Color,
    gammaCorrection: boolean,
    near: number,
    far: number
  ): void {
    this.uniforms.color.value = color;
    this.uniforms.near.value = near;
    this.uniforms.far.value = far;
    this.uniforms.gammaCorrection.value = gammaCorrection ? 1 : 0;
  }

  setSize(width: number, height: number): void {
    this.uniforms.resolution.value.set(width, height);
  }

  setGodraysResolution(width: number, height: number): void {
    this.uniforms.godraysResolution.value.set(width, height);
  }
}

export class GodraysCompositorPass extends Pass {
  sceneCamera: PerspectiveCamera;
  private depthCopyTarget: THREE.WebGLRenderTarget | null = null;

  constructor(props: GodraysCompositorMaterialProps) {
    // Newer versions of postprocessing provide an `OrthographicCamera` by default to `Pass`, but
    // our shaders were written expecting a base `THREE.Camera`.
    super('GodraysCompositorPass', undefined, new THREE.Camera());
    this.fullscreenMaterial = new GodraysCompositorMaterial(props);
    this.sceneCamera = props.camera;
  }

  public updateUniforms(params: GodraysPassParams): void {
    (this.fullscreenMaterial as GodraysCompositorMaterial).updateUniforms(
      params.color,
      params.gammaCorrection,
      this.sceneCamera.near,
      this.sceneCamera.far
    );
  }

  public updateDebugSteps(enabled: boolean): void {
    const mat = this.fullscreenMaterial as GodraysCompositorMaterial;
    const has = mat.defines.DEBUG_STEPS !== undefined;
    if (enabled && !has) {
      mat.defines.DEBUG_STEPS = '';
      mat.needsUpdate = true;
    } else if (!enabled && has) {
      delete mat.defines.DEBUG_STEPS;
      mat.needsUpdate = true;
    }
  }

  public updateUpsampleQuality(quality: GodraysUpsampleQuality): void {
    const mat = this.fullscreenMaterial as GodraysCompositorMaterial;
    const jbuExtent = quality >= 1 ? 1 : 0;
    const jbuSpatialSigma = jbuExtent === 1 ? 1.0 : 0.5;
    const needsUpdate = mat.defines.JBU_EXTENT !== String(jbuExtent);

    if (needsUpdate) {
      mat.defines.JBU_EXTENT = String(jbuExtent);
      mat.defines.JBU_SPATIAL_SIGMA = jbuSpatialSigma.toFixed(1);
      mat.needsUpdate = true;
    }
  }

  private maybeInitDepthCopyTarget(width: number, height: number): void {
    const needsRecreate =
      !this.depthCopyTarget ||
      this.depthCopyTarget.width !== width ||
      this.depthCopyTarget.height !== height;
    if (!needsRecreate) {
      return;
    }

    this.depthCopyTarget?.dispose();
    this.depthCopyTarget = new THREE.WebGLRenderTarget(width, height);
    this.depthCopyTarget.depthTexture = new THREE.DepthTexture(
      width,
      height,
      THREE.UnsignedIntType
    );
    this.depthCopyTarget.depthTexture.format = THREE.DepthFormat;
    this.depthCopyTarget.depthTexture.compareFunction = null as any;
    this.depthCopyTarget.depthTexture.minFilter = THREE.NearestFilter;
    this.depthCopyTarget.depthTexture.magFilter = THREE.NearestFilter;
  }

  private blitDepthTexture(
    renderer: THREE.WebGLRenderer,
    sourceBuffer: THREE.WebGLRenderTarget
  ): void {
    const gl = renderer.getContext() as WebGL2RenderingContext;

    const sourceProps = renderer.properties.get(sourceBuffer) as any;
    const srcFramebuffer = sourceProps.__webglFramebuffer;

    const copyTargetProps = renderer.properties.get(this.depthCopyTarget!) as any;
    let dstFramebuffer = copyTargetProps?.__webglFramebuffer;

    if (!dstFramebuffer) {
      // Force Three.js to initialize the framebuffer by doing a dummy render
      renderer.setRenderTarget(this.depthCopyTarget);
      renderer.clear();
      renderer.setRenderTarget(null);
      const updatedProps = renderer.properties.get(this.depthCopyTarget!) as any;
      dstFramebuffer = updatedProps.__webglFramebuffer;
    }

    if (!srcFramebuffer || !dstFramebuffer) {
      return;
    }

    const width = sourceBuffer.width;
    const height = sourceBuffer.height;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFramebuffer);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
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

    // There is a limitation in the pmndrs postprocessing library that causes rendering issues when
    // the depth texture provided to the effect is the same as the one bound to the output buffer.
    //
    // To work around this, we copy the depth texture to a new render target and use that instead
    // if it's found to be the same.
    const sceneDepth = (this.fullscreenMaterial as GodraysCompositorMaterial).uniforms.sceneDepth
      .value;
    if (
      sceneDepth &&
      outputBuffer &&
      outputBuffer.depthTexture &&
      sceneDepth === outputBuffer.depthTexture
    ) {
      this.maybeInitDepthCopyTarget(outputBuffer.width, outputBuffer.height);
      this.blitDepthTexture(renderer, outputBuffer);

      (this.fullscreenMaterial as GodraysCompositorMaterial).uniforms.sceneDepth.value =
        this.depthCopyTarget!.depthTexture;
    }

    renderer.setRenderTarget(outputBuffer);
    renderer.render(this.scene, this.camera);

    (this.fullscreenMaterial as GodraysCompositorMaterial).uniforms.sceneDepth.value = sceneDepth;
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

  public setGodraysResolution(width: number, height: number): void {
    (this.fullscreenMaterial as GodraysCompositorMaterial).setGodraysResolution(width, height);
  }
}
