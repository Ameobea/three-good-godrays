import { EffectComposer } from 'postprocessing';
import * as THREE from 'three';
import { calculateVerticalFoV, DemoManager, DemoManagerEvent } from 'three-demo';

import DirlightDemo from './dirlightDemo';
import PointlightDemo from './pointlightDemo';
import { SponzaDemo } from './sponzaDemo';

window.addEventListener('load', () => {
  const renderer = new THREE.WebGLRenderer({
    powerPreference: 'high-performance',
    antialias: false,
  });

  const viewport = document.getElementById('viewport');
  if (!viewport) {
    throw new Error('No viewport element found');
  }

  renderer.setSize(viewport.clientWidth, viewport.clientHeight);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  renderer.shadowMap.needsUpdate = true;

  const manager = new DemoManager(viewport, {
    aside: document.getElementById('aside') ?? undefined,
    renderer,
  });

  manager.addEventListener('change', (_event: DemoManagerEvent) => {
    renderer.shadowMap.needsUpdate = true;
    document.querySelector('.loading')?.classList.remove('hidden');
  });

  manager.addEventListener('load', (_event: DemoManagerEvent) => {
    document.querySelector('.loading')?.classList.add('hidden');
  });

  const composer = new EffectComposer(renderer);

  if (!window.location.hash) {
    window.location.hash = 'dirlight';
  }

  manager.addDemo(new DirlightDemo(composer));
  manager.addDemo(new PointlightDemo(composer));
  manager.addDemo(new SponzaDemo(composer));

  requestAnimationFrame(function render(timestamp) {
    requestAnimationFrame(render);
    manager.render(timestamp);
  });

  window.addEventListener('resize', event => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const demo = manager.getCurrentDemo();

    if (demo !== null) {
      const camera = demo.getCamera() as THREE.PerspectiveCamera;

      if (camera !== null) {
        const aspect = Math.max(width / height, 16 / 9);
        const vFoV = calculateVerticalFoV(90, aspect);
        camera.fov = vFoV;
      }
    }

    manager.setSize(width, height, true);
    composer.setSize(width, height);
  });
});

document.addEventListener('DOMContentLoaded', (event: Event) => {
  const img = document.querySelector('.info img');
  const div = document.querySelector('.info div');

  if (img !== null && div !== null) {
    img.addEventListener('click', () => {
      div.classList.toggle('hidden');
    });
  }
});
