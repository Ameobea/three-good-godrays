import { type GUI } from 'dat.gui';
import { EffectComposer, KernelSize } from 'postprocessing';
import * as THREE from 'three';
import { Demo } from 'three-demo';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { GodraysPass, GodraysPassParams } from '../../src/index';

type GodraysPassParamsState = Omit<GodraysPassParams, 'color' | 'blur'> & {
  color: number;
  enableBlur: boolean;
  blurVariance: number;
  blurKernelSize: KernelSize;
};

export class BaseDemo extends Demo {
  public controls: OrbitControls;
  public godraysPass: GodraysPass;
  public params: GodraysPassParamsState = {
    density: 0.006,
    maxDensity: 2 / 3,
    distanceAttenuation: 2,
    color: new THREE.Color(0xffffff).getHex(),
    edgeStrength: 2,
    edgeRadius: 2,
    raymarchSteps: 60,
    enableBlur: false,
    blurVariance: 0.1,
    blurKernelSize: KernelSize.SMALL,
  };

  public composer: EffectComposer;

  constructor(name: string, composer: EffectComposer) {
    super(name);
    this.composer = composer;
  }

  public onParamChange = (key: string, value: any) => {
    this.params[key] = value;

    this.godraysPass.setParams({
      ...this.params,
      color: new THREE.Color(this.params.color),
      blur: this.params.enableBlur
        ? { variance: this.params.blurVariance, kernelSize: this.params.blurKernelSize }
        : false,
    });
  };

  registerOptions(menu: GUI) {
    const mkOnChange = (key: string) => (value: any) => this.onParamChange(key, value);

    menu
      .add(this.params, 'density', 0, this.id === 'sponza' ? 0.15 : 0.03)
      .onChange(mkOnChange('density'));
    menu.add(this.params, 'maxDensity', 0, 1).onChange(mkOnChange('maxDensity'));
    menu.add(this.params, 'distanceAttenuation', 0, 5).onChange(mkOnChange('distanceAttenuation'));
    menu.addColor(this.params, 'color').onChange(mkOnChange('color'));
    menu.add(this.params, 'edgeStrength', 0, 10, 1).onChange(mkOnChange('edgeStrength'));
    menu.add(this.params, 'edgeRadius', 0, 10, 1).onChange(mkOnChange('edgeRadius'));
    menu.add(this.params, 'raymarchSteps', 1, 200, 1).onChange(mkOnChange('raymarchSteps'));
    menu.add(this.params, 'enableBlur', false).onChange(mkOnChange('enableBlur'));
    menu.add(this.params, 'blurVariance', 0.001, 0.5, 0.001).onChange(mkOnChange('blurVariance'));
    menu
      .add(this.params, 'blurKernelSize', {
        VERY_SMALL: KernelSize.VERY_SMALL,
        SMALL: KernelSize.SMALL,
        MEDIUM: KernelSize.MEDIUM,
        LARGE: KernelSize.LARGE,
        VERY_LARGE: KernelSize.VERY_LARGE,
        HUGE: KernelSize.HUGE,
      })
      .onChange(mkOnChange('blurKernelSize'));

    if (window.innerWidth < 720) {
      menu.close();
    }
  }
}
