/*
 * Code taken from this demo: https://n8python.github.io/goodGodRays/
 * By: https://github.com/n8python
 *
 * With cleanup and minor changes
 */

#include <common>

uniform sampler2D godrays;
uniform sampler2D sceneDiffuse;
uniform sampler2D sceneDepth;
uniform float edgeStrength;
uniform float edgeRadius;
uniform vec2 resolution;
uniform float near;
uniform float far;
uniform vec3 color;
uniform bool gammaCorrection;
varying vec2 vUv;

#define DITHERING
#include <dithering_pars_fragment>

float linearize_depth(float d, float zNear, float zFar) {
  return zNear * zFar / (zFar + d * (zNear - zFar));
}

vec4 LinearTosRGB_(in vec4 value) {
  return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92, vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
}

void main() {
  float rawDepth = texture2D(sceneDepth, vUv).x;
  float correctDepth = linearize_depth(rawDepth, near, far);

  vec2 pushDir = vec2(0.0);
  float count = 0.0;
  for (float x = -edgeRadius; x <= edgeRadius; x++) {
    for (float y = -edgeRadius; y <= edgeRadius; y++) {
      vec2 sampleUv = (vUv * resolution + vec2(x, y)) / resolution;
      float sampleDepth = texelFetch(sceneDepth, ivec2(sampleUv * resolution), 0).x;
      sampleDepth = linearize_depth(sampleDepth, near, far);
      if (abs(sampleDepth - correctDepth) < 0.05 * correctDepth) {
        pushDir += vec2(x, y);
        count += 1.0;
      }
    }
  }

  if (count == 0.0) {
    count = 1.0;
  }

  pushDir /= count;
  pushDir = normalize(pushDir);
  vec2 sampleUv = length(pushDir) > 0.0 ? vUv + edgeStrength * (pushDir / resolution) : vUv;
  float bestChoice = texture2D(godrays, sampleUv).x;

  vec3 diffuse = texture2D(sceneDiffuse, vUv).rgb;
  gl_FragColor = vec4(mix(diffuse, color, bestChoice), 1.0);

  #include <dithering_fragment>

  if (gammaCorrection) {
    gl_FragColor = LinearTosRGB_(gl_FragColor);
  }
}
