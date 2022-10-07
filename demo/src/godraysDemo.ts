import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Demo } from "three-demo";
import {
  EffectComposer,
  RenderPass,
  SMAAEffect,
  EffectPass,
} from "postprocessing";

import { GodraysPass, GodraysPassParams } from "../../src/index";

type GodraysPassParamsState = Omit<GodraysPassParams, "color"> & {
  color: number;
};

export default class GodraysDemo extends Demo {
  private composer: EffectComposer;
  private controls: OrbitControls;
  private godraysPass: GodraysPass;
  private params: GodraysPassParamsState = {
    density: 0.006,
    maxDensity: 2 / 3,
    distanceAttenuation: 0.004,
    color: new THREE.Color(0xffffff).getHex(),
    edgeStrength: 1,
    edgeRadius: 1,
  };

  constructor(composer: EffectComposer) {
    super("basic-godrays");

    this.composer = composer;
  }

  override async load(): Promise<void> {
    const loader = new GLTFLoader(this.loadingManager);
    const gltf = await loader.loadAsync("/godrays_demo.glb");
    this.scene.add(...gltf.scene.children);
  }

  initialize() {
    const pillars = this.scene.getObjectByName("pillars") as THREE.Mesh;
    pillars.material = new THREE.MeshStandardMaterial({
      color: 0x333333,
    });

    const base = this.scene.getObjectByName("base") as THREE.Mesh;
    base.material = new THREE.MeshStandardMaterial({
      color: 0x333333,
    });

    const lightSphere = this.scene.getObjectByName(
      "light_sphere"
    ) as THREE.Mesh;
    lightSphere.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });
    const lightPos = new THREE.Vector3();
    lightSphere.getWorldPosition(lightPos);

    this.scene.add(new THREE.AmbientLight(0xcccccc, 0.4));

    const backdropDistance = 200;
    // Add backdrop walls `backdropDistance` units away from the origin
    const backdropGeometry = new THREE.PlaneGeometry(1000, 1000);
    const backdropMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
    });
    const backdropLeft = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdropLeft.position.set(-backdropDistance, 0, 0);
    backdropLeft.rotateY(Math.PI / 2);
    this.scene.add(backdropLeft);
    const backdropRight = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdropRight.position.set(backdropDistance, 0, 0);
    backdropRight.rotateY(Math.PI / 2);
    this.scene.add(backdropRight);
    const backdropFront = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdropFront.position.set(0, 0, -backdropDistance);
    this.scene.add(backdropFront);
    // const backdropBack = new THREE.Mesh(backdropGeometry, backdropMaterial);
    // backdropBack.position.set(0, 0, backdropDistance);
    // this.scene.add(backdropBack);

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    lightSphere.castShadow = false;
    lightSphere.receiveShadow = false;

    this.camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 1000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    this.camera.position.set(-140, 110, -200);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    const renderPass = new RenderPass(this.scene, this.camera);
    renderPass.renderToScreen = false;
    this.composer.addPass(renderPass);

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;

    const pointLight = new THREE.PointLight(0xffffff, 0.3, 1000, 0.5);
    pointLight.castShadow = true;
    // pointLight.shadow.bias = -0.005;
    pointLight.shadow.mapSize.width = 1024;
    pointLight.shadow.mapSize.height = 1024;
    pointLight.shadow.autoUpdate = true;
    pointLight.shadow.camera.near = 0.1;
    pointLight.shadow.camera.far = 1000;
    pointLight.shadow.camera.updateProjectionMatrix();
    pointLight.position.copy(lightPos);
    this.scene.add(pointLight);

    this.godraysPass = new GodraysPass(pointLight, this.camera, {
      ...this.params,
      color: new THREE.Color(this.params.color),
    });
    this.godraysPass.renderToScreen = false;
    this.composer.addPass(this.godraysPass);

    const smaaEffect = new SMAAEffect({ edgeDetectionMode: 0.05 });
    const smaaPass = new EffectPass(this.camera, smaaEffect);
    smaaPass.renderToScreen = true;
    this.composer.addPass(smaaPass);
  }

  render(deltaTime: number, timestamp?: number | undefined): void {
    this.controls.update();
    this.composer.render(deltaTime);
  }

  registerOptions(menu) {
    const params = this.params;

    const mkOnChange = (key) => (value) => {
      params[key] = value;
      this.godraysPass.setParams({
        ...params,
        color: new THREE.Color(params.color),
      });
    };

    menu.add(params, "density", 0, 0.03).onChange(mkOnChange("density"));
    menu.add(params, "maxDensity", 0, 1).onChange(mkOnChange("maxDensity"));
    menu
      .add(params, "distanceAttenuation", 0, 0.02)
      .onChange(mkOnChange("distanceAttenuation"));
    menu.addColor(params, "color").onChange(mkOnChange("color"));
    menu
      .add(params, "edgeStrength", 0, 10, 1)
      .onChange(mkOnChange("edgeStrength"));
    menu.add(params, "edgeRadius", 0, 10, 1).onChange(mkOnChange("edgeRadius"));

    if (window.innerWidth < 720) {
      menu.close();
    }
  }
}
