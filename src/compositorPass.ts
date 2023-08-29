import { CopyPass, Pass, Resizable } from 'postprocessing';
import * as THREE from 'three';
import type { PerspectiveCamera } from 'three';

import GodraysCompositorFragmentShader from './compositor.frag';
import GodraysCompositorVertexShader from './compositor.vert';
import type { GodraysPassParams } from './index';

interface GodraysCompositorMaterialProps {
  godrays: THREE.Texture;
  edgeStrength: number;
  edgeRadius: number;
  color: THREE.Color;
  camera: THREE.PerspectiveCamera;
}

export class GodraysCompositorMaterial extends THREE.ShaderMaterial implements Resizable {
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

export class GodraysCompositorPass extends Pass {
  sceneCamera: PerspectiveCamera;
  private depthCopyRenderTexture: THREE.WebGLRenderTarget | null = null;
  private depthTextureCopyPass: CopyPass | null = null;

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

    // There is a limitation in the pmndrs postprocessing library that causes rendering issues when
    // the depth texture provided to the effect is the same as the one bound to the output buffer.
    //
    // To work around this, we copy the depth texture to a new render target and use that instead
    // if it's found to be the same.
    const sceneDepth = (this.fullscreenMaterial as GodraysCompositorMaterial).uniforms.sceneDepth
      .value;
    if (sceneDepth && outputBuffer && sceneDepth === outputBuffer.depthTexture) {
      if (!this.depthCopyRenderTexture) {
        this.depthCopyRenderTexture = new THREE.WebGLRenderTarget(
          outputBuffer.depthTexture.image.width,
          outputBuffer.depthTexture.image.height,
          {
            minFilter: outputBuffer.depthTexture.minFilter,
            magFilter: outputBuffer.depthTexture.magFilter,
            format: outputBuffer.depthTexture.format,
            generateMipmaps: outputBuffer.depthTexture.generateMipmaps,
          }
        );
      }
      if (!this.depthTextureCopyPass) {
        this.depthTextureCopyPass = new CopyPass();
      }

      this.depthTextureCopyPass.render(
        renderer,
        (this.fullscreenMaterial as GodraysCompositorMaterial).uniforms.sceneDepth.value,
        this.depthCopyRenderTexture
      );
      (this.fullscreenMaterial as GodraysCompositorMaterial).uniforms.sceneDepth.value =
        this.depthCopyRenderTexture.texture;
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
}
