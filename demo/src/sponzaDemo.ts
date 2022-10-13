import { EffectComposer, EffectPass, RenderPass, SMAAEffect } from 'postprocessing';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { GodraysPass } from '../../src';
import { BaseDemo } from './BaseDemo';

export class SponzaDemo extends BaseDemo {
  private setLightY: (y: number) => void;

  constructor(composer: EffectComposer) {
    super('sponza', composer);
  }

  override async load(): Promise<void> {
    const loader = new GLTFLoader(this.loadingManager);
    const gltf = await loader.loadAsync('https://ameo.dev/static/sponza.glb');
    this.scene.add(...gltf.scene.children);
  }

  initialize() {
    this.camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 1000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.camera.position.set(4.5, 4.5, 4.5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    const ambientLight = new THREE.AmbientLight(0xcccccc, 1);
    this.scene.add(ambientLight);

    const lightPos = new THREE.Vector3(0, 5, 0);
    const lightSphereMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });
    const lightSphere = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), lightSphereMaterial);
    lightSphere.position.copy(lightPos);
    this.scene.add(lightSphere);

    const pointLight = new THREE.PointLight(0xffffff, 2.3, 25, 0.5);
    pointLight.castShadow = true;
    pointLight.shadow.bias = -0.00005;
    pointLight.shadow.mapSize.width = 1024 * 2;
    pointLight.shadow.mapSize.height = 1024 * 2;
    pointLight.shadow.autoUpdate = true;
    pointLight.shadow.camera.near = 0.1;
    pointLight.shadow.camera.far = 1;
    pointLight.shadow.camera.updateProjectionMatrix();
    pointLight.position.copy(lightPos);
    this.scene.add(pointLight);

    this.scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    lightSphere.castShadow = false;
    lightSphere.receiveShadow = false;

    const renderPass = new RenderPass(this.scene, this.camera);
    renderPass.renderToScreen = false;
    this.composer.addPass(renderPass);

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.shadowMap.needsUpdate = true;

    this.params.density = 0.07;
    this.godraysPass = new GodraysPass(pointLight, this.camera as THREE.PerspectiveCamera, {
      ...this.params,
      color: new THREE.Color(this.params.color),
    });
    this.godraysPass.renderToScreen = false;
    this.composer.addPass(this.godraysPass);

    this.onParamChange('density', 0.07);

    const smaaEffect = new SMAAEffect();
    const smaaPass = new EffectPass(this.camera, smaaEffect);
    smaaPass.renderToScreen = true;
    this.composer.addPass(smaaPass);

    this.setLightY = (y: number) => {
      pointLight.position.y = y;
      lightSphere.position.y = y;
    };
  }

  render(deltaTime: number, rawTs?: number | undefined): void {
    const curTime = rawTs !== undefined ? rawTs : performance.now();
    this.setLightY(Math.sin(curTime * 0.0005) * 3 + 5);
    this.controls.update();
    this.composer.render(deltaTime);
  }
}
