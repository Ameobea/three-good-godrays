import { type GUI } from 'dat.gui';
import { EffectComposer, KernelSize } from 'postprocessing';
import * as THREE from 'three';
import { Demo } from 'three-demo';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { GodraysPass, GodraysPassParams, GodraysUpsampleQuality } from '../../src/index';

THREE.ColorManagement.enabled = true;

interface GodraysPassParamsState
  extends Omit<GodraysPassParams, 'color' | 'blur' | 'adaptiveSteps' | 'debugSteps'> {
  color: number;
  enableBlur: boolean;
  blurVariance: number;
  blurKernelSize: KernelSize;
  upsampleQuality: GodraysUpsampleQuality;
  debugSteps: boolean;
  useAdaptiveSteps: boolean;
  stepSize: number;
  minSteps: number;
  maxSteps: number;
}

export class BaseDemo extends Demo {
  public controls: OrbitControls;
  public godraysPass: GodraysPass;
  public params: GodraysPassParamsState = {
    density: 0.015,
    maxDensity: 1,
    distanceAttenuation: 2,
    color: new THREE.Color(0xffffff).getHex(),
    raymarchSteps: 60,
    enableBlur: true,
    blurVariance: 0.125,
    blurKernelSize: KernelSize.MEDIUM,
    gammaCorrection: false,
    resolutionScale: 0.5,
    upsampleQuality: GodraysUpsampleQuality.HIGH,
    useAdaptiveSteps: false,
    stepSize: 3.5,
    minSteps: 8,
    maxSteps: 125,
    debugSteps: false,
  };

  public composer: EffectComposer;

  constructor(name: string, composer: EffectComposer) {
    super(name);
    this.composer = composer;
  }

  public buildPassParams(): Partial<GodraysPassParams> {
    const passParams: Partial<GodraysPassParams> = {
      density: this.params.density,
      maxDensity: this.params.maxDensity,
      distanceAttenuation: this.params.distanceAttenuation,
      color: new THREE.Color(this.params.color),
      blur: this.params.enableBlur
        ? { variance: this.params.blurVariance, kernelSize: this.params.blurKernelSize }
        : false,
      gammaCorrection: this.params.gammaCorrection,
      resolutionScale: this.params.resolutionScale,
      upsampleQuality: this.params.upsampleQuality,
      debugSteps: this.params.debugSteps,
    };
    if (this.params.useAdaptiveSteps) {
      passParams.adaptiveSteps = {
        stepSize: this.params.stepSize,
        minSteps: this.params.minSteps,
        maxSteps: this.params.maxSteps,
      };
    } else {
      passParams.raymarchSteps = this.params.raymarchSteps;
    }
    return passParams;
  }

  public onParamChange = (key: string, value: any) => {
    this.params[key] = value;
    this.godraysPass.setParams(this.buildPassParams());
  };

  registerOptions(menu: GUI) {
    const mkOnChange = (key: string) => (value: any) => this.onParamChange(key, value);

    menu
      .add(this.params, 'density', 0, this.id === 'sponza' ? 0.15 : 0.03)
      .onChange(mkOnChange('density'));
    menu.add(this.params, 'maxDensity', 0, 1).onChange(mkOnChange('maxDensity'));
    menu.add(this.params, 'distanceAttenuation', 0, 5).onChange(mkOnChange('distanceAttenuation'));
    menu.addColor(this.params, 'color').onChange(mkOnChange('color'));
    menu
      .add(this.params, 'upsampleQuality', {
        LOW: GodraysUpsampleQuality.LOW,
        HIGH: GodraysUpsampleQuality.HIGH,
      })
      .onChange(mkOnChange('upsampleQuality'));
    menu.add(this.params, 'resolutionScale', 0.1, 1, 0.05).onChange(mkOnChange('resolutionScale'));
    menu.add(this.params, 'raymarchSteps', 1, 200, 1).onChange(mkOnChange('raymarchSteps'));
    menu.add(this.params, 'debugSteps').onChange(mkOnChange('debugSteps'));
    menu.add(this.params, 'useAdaptiveSteps').onChange(mkOnChange('useAdaptiveSteps'));
    menu.add(this.params, 'stepSize', 0.1, 50, 0.1).onChange(mkOnChange('stepSize'));
    menu.add(this.params, 'minSteps', 1, 50, 1).onChange(mkOnChange('minSteps'));
    menu.add(this.params, 'maxSteps', 10, 300, 1).onChange(mkOnChange('maxSteps'));
    menu.add(this.params, 'enableBlur', true).onChange(mkOnChange('enableBlur'));
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
