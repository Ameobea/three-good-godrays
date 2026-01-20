import * as THREE from 'three';

import Stats from 'three/addons/libs/stats.module.js';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { EffectComposer, RenderPass } from 'postprocessing';
import { GodraysPass } from '../../src/index';

let camera, scene, renderer, composer;
let controls, stats;

init();

async function init() {

    camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.1, 1000 );
    camera.position.set( - 175, 50, 0 );

    scene = new THREE.Scene();
    scene.background = new THREE.Color( 0x000000 );

    // asset

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync( 'https://raw.githack.com/mrdoob/three.js/b48227fffdc535cc42ad4050c719912159090c47/examples/models/gltf/godrays_demo.glb' );
    scene.add( gltf.scene );

    const pillars = gltf.scene.getObjectByName( 'concrete' );
    pillars.material = new THREE.MeshStandardMaterial( {
        color: 0x333333,
    } );

    const base = gltf.scene.getObjectByName( 'base' );
    base.material = new THREE.MeshStandardMaterial( {
        color: 0x333333,
        side: THREE.DoubleSide,
    } );

    setupBackdrop();

    // lights

    const lightPos = new THREE.Vector3( 0, 100, 100 );
    const lightSphereMaterial = new THREE.MeshBasicMaterial( {
        color: 0xffffff,
    } );
    const lightSphere = new THREE.Mesh( new THREE.SphereGeometry( 0.5, 16, 16 ), lightSphereMaterial );
    lightSphere.position.copy( lightPos );
    scene.add( lightSphere );

    scene.add( new THREE.AmbientLight( 0xcccccc, 0.4 ) );

    const dirLight = new THREE.DirectionalLight( 0xf6287d, 3 );
    dirLight.castShadow = true;
    dirLight.shadow.bias = - 0.001;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.top = 200;
    dirLight.shadow.camera.bottom = - 200;
    dirLight.shadow.camera.left = - 200;
    dirLight.shadow.camera.right = 200;
    dirLight.position.copy( lightPos );
    scene.add( dirLight );

    // shadow setup

    scene.traverse( obj => {

        if ( obj.isMesh === true ) {

            obj.castShadow = true;
            obj.receiveShadow = true;

        }

    } );

    lightSphere.castShadow = false;
    lightSphere.receiveShadow = false;

    //

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setAnimationLoop( animate );
    renderer.shadowMap.enabled = true;
    console.log('OLD: ', renderer.shadowMap.type)
    renderer.shadowMap.type = THREE.PCFShadowMap;
    document.body.appendChild( renderer.domElement );

    //

    composer = new EffectComposer( renderer, { frameBufferType: THREE.HalfFloatType } );

    const renderPass = new RenderPass( scene, camera );
    composer.addPass( renderPass );

    const params = {
        density: 1 / 128,
        maxDensity: 0.5,
        edgeStrength: 2,
        edgeRadius: 2,
        distanceAttenuation: 2,
        color: new THREE.Color( 0xf6287d ),
        raymarchSteps: 60,
        blur: true,
        gammaCorrection: true,
    };


    const godraysPass = new GodraysPass( dirLight, camera, params );
    godraysPass.renderToScreen = true;
    composer.addPass( godraysPass );

    //

    controls = new OrbitControls( camera, renderer.domElement );
    controls.target.set( 0, 0.5, 0 );
    controls.enableDamping = true;
    controls.maxDistance = 200;
    controls.update();

    //

    stats = new Stats();
    document.body.appendChild( stats.dom );

    //

    window.addEventListener( 'resize', onWindowResize );


}

//

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize( window.innerWidth, window.innerHeight );

}

function setupBackdrop() {

        const backdropDistance = 200;
    // Add backdrop walls `backdropDistance` units away from the origin
    const backdropGeometry = new THREE.PlaneGeometry( 400, 200 );
    const backdropMaterial = new THREE.MeshBasicMaterial( {
        color: 0x200808,
        side: THREE.DoubleSide,
    } );
    const backdropLeft = new THREE.Mesh( backdropGeometry, backdropMaterial );
    backdropLeft.position.set( - backdropDistance, 100, 0 );
    backdropLeft.rotateY( Math.PI / 2 );
    scene.add( backdropLeft );

    const backdropRight = new THREE.Mesh( backdropGeometry, backdropMaterial );
    backdropRight.position.set( backdropDistance, 100, 0 );
    backdropRight.rotateY( Math.PI / 2 );
    scene.add( backdropRight );

    const backdropFront = new THREE.Mesh( backdropGeometry, backdropMaterial );
    backdropFront.position.set( 0, 100, - backdropDistance );
    scene.add( backdropFront );

    const backdropBack = new THREE.Mesh( backdropGeometry, backdropMaterial );
    backdropBack.position.set( 0, 100, backdropDistance );
    scene.add( backdropBack );

    const backdropTop = new THREE.Mesh( backdropGeometry, backdropMaterial );
    backdropTop.position.set( 0, 200, 0 );
    backdropTop.rotateX( Math.PI / 2 );
    backdropTop.scale.set( 3, 6, 1 );
    scene.add( backdropTop );

}

function animate() {

    controls.update();

    stats.begin();

    composer.render();

    //renderer.render( scene, camera );

    stats.end();

}