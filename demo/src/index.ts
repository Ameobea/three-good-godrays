import { EffectComposer } from "postprocessing";
import * as THREE from "three";
import {
  DemoManager,
  calculateVerticalFoV,
  DemoManagerEvent,
} from "three-demo";

import GodraysDemo from "./godraysDemo";

window.addEventListener("load", () => {
  const renderer = new THREE.WebGLRenderer({
    powerPreference: "high-performance",
    antialias: false,
  });

  const viewport = document.getElementById("viewport");
  if (!viewport) {
    throw new Error("No viewport element found");
  }

  renderer.setSize(viewport.clientWidth, viewport.clientHeight);

  const manager = new DemoManager(viewport, {
    aside: document.getElementById("aside") ?? undefined,
    renderer,
  });

  manager.addEventListener("change", (_event: DemoManagerEvent) => {
    document.querySelector(".loading")?.classList.remove("hidden");
  });

  manager.addEventListener("load", (_event: DemoManagerEvent) => {
    document.querySelector(".loading")?.classList.add("hidden");
  });

  const composer = new EffectComposer(renderer);

  // Set URL hash to `#basic-godrays` to load the demo automatically.
  window.location.hash = "basic-godrays";

  manager.addDemo(new GodraysDemo(composer));

  requestAnimationFrame(function render(timestamp) {
    requestAnimationFrame(render);
    manager.render(timestamp);
  });

  window.addEventListener("resize", (event) => {
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

document.addEventListener("DOMContentLoaded", (event: Event) => {
  const img = document.querySelector(".info img");
  const div = document.querySelector(".info div");

  if (img !== null && div !== null) {
    img.addEventListener("click", () => {
      div.classList.toggle("hidden");
    });
  }
});
