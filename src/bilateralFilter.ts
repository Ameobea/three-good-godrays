import { Disposable, KernelSize, Pass, Resizable } from 'postprocessing';
import * as THREE from 'three';

import BilateralFilterFragmentShader from './bilateralFilter.frag';
import GodraysCompositorVertexShader from './compositor.vert';
import type { GodraysBlurParams } from './index';

export const GODRAYS_BLUR_RESOLUTION_SCALE = 1;

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

export class BilateralFilterPass extends Pass implements Resizable, Disposable {
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

  public override dispose() {
    this.material.dispose();
    super.dispose();
  }
}
