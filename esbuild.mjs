/**
 * Adapted from `postprocessing` library: https://github.com/pmndrs/postprocessing/blob/main/esbuild.mjs
 *
 * Zlib license:
 *
 * Copyright © 2015 Raoul van Rüschen
 *
 * This software is provided 'as-is', without any express or implied warranty. In no event will the authors be held liable for any damages arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions:
 *
 * The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.
 *
 * Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.
 *
 * This notice may not be removed or altered from any source distribution.
 */

import { createRequire } from "module";
import { glsl } from "esbuild-plugin-glsl";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const pkg = require("./package");
const external = Object.keys(pkg.peerDependencies || {});
const minify = process.argv.includes("-m");
const watch = process.argv.includes("-w");
const plugins = [glsl({ minify })];

await esbuild
  .build({
    entryPoints: ["demo/src/index.ts"],
    outdir: "public/demo",
    target: "es6",
    logLevel: "info",
    format: "iife",
    bundle: true,
    plugins,
    minify,
    watch,
  })
  .catch(() => process.exit(1));

await esbuild
  .build({
    entryPoints: ["src/index.ts"],
    outfile: `build/${pkg.name}.esm.js`,
    logLevel: "info",
    format: "esm",
    target: "es2019",
    bundle: true,
    external,
    plugins,
  })
  .catch(() => process.exit(1));

await esbuild
  .build({
    entryPoints: ["src/index.ts"],
    outfile: `build/${pkg.name}.mjs`,
    logLevel: "info",
    format: "esm",
    target: "es2019",
    bundle: true,
    external,
    plugins,
  })
  .catch(() => process.exit(1));

// @todo Remove in next major release.
const globalName = pkg.name.replace(/-/g, "").toUpperCase();
// const requireShim = `if(typeof window==="object"&&!window.require)window.require=()=>window.THREE;`;
const footer = `if(typeof module==="object"&&module.exports)module.exports=${globalName};`;

await esbuild
  .build({
    entryPoints: ["src/index.ts"],
    outfile: `build/${pkg.name}.js`,
    footer: { js: footer },
    logLevel: "info",
    format: "iife",
    target: "es6",
    bundle: true,
    globalName,
    external,
    plugins,
  })
  .catch(() => process.exit(1));

await esbuild
  .build({
    entryPoints: ["src/index.ts"],
    outfile: `build/${pkg.name}.min.js`,
    footer: { js: footer },
    logLevel: "info",
    format: "iife",
    target: "es6",
    bundle: true,
    globalName,
    external,
    plugins,
    minify,
  })
  .catch(() => process.exit(1));
