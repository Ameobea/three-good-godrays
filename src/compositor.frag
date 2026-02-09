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

float linearize_depth(float depth, float zNear, float zFar) {
  #if defined( USE_LOGDEPTHBUF )
  float d = pow(2.0, depth * log2(far + 1.0)) - 1.0;
  float a = far / (far - near);
  float b = far * near / (near - far);
  depth = a + b / d;
  #endif

  return zNear * zFar / (zFar + depth * (zNear - zFar));
}

vec4 LinearTosRGB_(in vec4 value) {
  return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92, vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
}

void main() {
  float rawDepth = texture2D(sceneDepth, vUv).x;
  float correctDepth = linearize_depth(rawDepth, near, far);

  const vec2 poissonDisk[8] = vec2[8](
    vec2( 0.493393,  0.394269),
    vec2( 0.798547,  0.885922),
    vec2( 0.259143,  0.650754),
    vec2( 0.605322,  0.023588),
    vec2(-0.574681,  0.137452),
    vec2(-0.430397, -0.638423),
    vec2(-0.849487, -0.366258),
    vec2( 0.170621, -0.569941)
  );

  vec2 pushDir = vec2(0.0);
  float count = 0.0;
  vec2 pixelStep = 1.0 / resolution;
  for (int i = 0; i < 8; i++) {
    vec2 offset = poissonDisk[i] * edgeRadius;
    vec2 sampleUv = vUv + offset * pixelStep;
    float sampleDepth = texture2D(sceneDepth, sampleUv).x;
    sampleDepth = linearize_depth(sampleDepth, near, far);
    if (abs(sampleDepth - correctDepth) < 0.05 * correctDepth) {
      pushDir += offset;
      count += 1.0;
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
