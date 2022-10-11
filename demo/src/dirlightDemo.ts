import { EffectComposer, EffectPass, RenderPass, SMAAEffect } from 'postprocessing';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { GodraysPass } from '../../src/index';
import { BaseDemo } from './BaseDemo';

export default class DirlightDemo extends BaseDemo {
  constructor(composer: EffectComposer) {
    super('dirlight', composer);
  }

  override async load(): Promise<void> {
    const loader = new GLTFLoader(this.loadingManager);
    const gltf = await loader.loadAsync('/demo_dirlight.glb');
    this.scene.add(...gltf.scene.children);
  }

  initialize() {
    const pillars = this.scene.getObjectByName('pillars') as THREE.Mesh;
    pillars.material = new THREE.MeshStandardMaterial({
      color: 0x333333,
    });

    const base = this.scene.getObjectByName('base') as THREE.Mesh;
    base.material = new THREE.MeshStandardMaterial({
      color: 0x333333,
    });

    const lightSphere = this.scene.getObjectByName('light_sphere') as THREE.Mesh;
    lightSphere.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });
    const lightPos = new THREE.Vector3();
    lightSphere.getWorldPosition(lightPos);

    this.scene.add(new THREE.AmbientLight(0xcccccc, 0.4));

    const backdropDistance = 200;
    // Add backdrop walls `backdropDistance` units away from the origin
    const backdropGeometry = new THREE.PlaneGeometry(400, 400);
    const backdropMaterial = new THREE.MeshBasicMaterial({
      color: 0x200808,
      side: THREE.DoubleSide,
    });
    const backdropLeft = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdropLeft.position.set(-backdropDistance, 200, 0);
    backdropLeft.rotateY(Math.PI / 2);
    this.scene.add(backdropLeft);
    const backdropRight = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdropRight.position.set(backdropDistance, 200, 0);
    backdropRight.rotateY(Math.PI / 2);
    this.scene.add(backdropRight);
    // const backdropFront = new THREE.Mesh(backdropGeometry, backdropMaterial);
    // backdropFront.position.set(0, 200, -backdropDistance);
    // this.scene.add(backdropFront);
    const backdropBack = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdropBack.position.set(0, 200, backdropDistance);
    this.scene.add(backdropBack);

    this.scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    lightSphere.castShadow = false;
    lightSphere.receiveShadow = false;

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    this.camera.position.set(-140, 110, -200);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    const renderPass = new RenderPass(this.scene, this.camera);
    renderPass.renderToScreen = false;
    this.composer.addPass(renderPass);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -150;
    dirLight.shadow.camera.right = 190;
    dirLight.shadow.camera.top = 200;
    dirLight.shadow.camera.bottom = -110;
    dirLight.shadow.camera.updateProjectionMatrix();
    dirLight.shadow.autoUpdate = true;
    dirLight.position.copy(lightPos).add(new THREE.Vector3(0, 0, 10));
    dirLight.target.position.set(0, 0, -500);
    dirLight.target.updateMatrixWorld();
    this.scene.add(dirLight.target);
    this.scene.add(dirLight);

    // helper
    const dirLightHelper = new THREE.DirectionalLightHelper(dirLight, 5);
    this.scene.add(dirLightHelper);
    const dirLightCameraHelper = new THREE.CameraHelper(dirLight.shadow.camera);
    this.scene.add(dirLightCameraHelper);

    this.godraysPass = new GodraysPass(dirLight, this.camera as THREE.PerspectiveCamera, {
      ...this.params,
      color: new THREE.Color(this.params.color),
    });
    this.godraysPass.renderToScreen = false;
    this.composer.addPass(this.godraysPass);

    const smaaEffect = new SMAAEffect();
    const smaaPass = new EffectPass(this.camera, smaaEffect);
    smaaPass.renderToScreen = true;
    this.composer.addPass(smaaPass);
  }

  render(deltaTime: number, timestamp?: number | undefined): void {
    this.controls.update();
    this.composer.render(deltaTime);
  }
}
