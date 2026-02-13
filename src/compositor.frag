/*
 * Joint bilateral upsampling compositor for godrays.
 *
 * Composites low-resolution godrays into the full-resolution scene using
 * depth-aware upsampling to preserve sharp edges at depth discontinuities.
 *
 * The godrays texture stores illumination in R and scene depth in A.
 * For each full-res pixel, we sample a neighborhood of low-res godrays texels
 * and weight each by spatial proximity and depth similarity, preventing
 * godrays from bleeding across depth edges.
 */

#include <common>

uniform sampler2D godrays;
uniform sampler2D sceneDiffuse;
uniform sampler2D sceneDepth;
uniform vec2 resolution;
uniform vec2 godraysResolution;
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

  vec2 texelSize = 1.0 / godraysResolution;

  // Position of this full-res pixel in low-res texel coordinates.
  // Texel (i,j) has its center at UV ((i + 0.5) / width, (j + 0.5) / height),
  // so the -0.5 converts from UV-scaled to integer texel space.
  vec2 texelPos = vUv * godraysResolution - 0.5;
  vec2 base = floor(texelPos);
  vec2 f = texelPos - base;

  float totalWeight = 0.0;
  float totalIllum = 0.0;

  // Joint bilateral upsampling: sample low-res texels in a neighborhood,
  // weighting each by spatial proximity and depth similarity.
  // JBU_EXTENT=0 gives the 2x2 bilinear quad (4 taps),
  // JBU_EXTENT=1 extends one texel in each direction (4x4 = 16 taps).
  for (int y = -JBU_EXTENT; y <= 1 + JBU_EXTENT; y++) {
    for (int x = -JBU_EXTENT; x <= 1 + JBU_EXTENT; x++) {
      vec2 sampleUv = (base + vec2(float(x), float(y)) + 0.5) * texelSize;
      vec4 data = texture2D(godrays, sampleUv);
      float sampleDepth = data.a; // already linearized by the godrays/blur pass

      // Gaussian spatial weight based on distance in texel units
      vec2 d = vec2(float(x), float(y)) - f;
      float spatialW = exp(-dot(d, d) / (2.0 * JBU_SPATIAL_SIGMA * JBU_SPATIAL_SIGMA));

      // Gaussian depth weight based on relative depth difference
      float depthDiff = (sampleDepth - correctDepth) / max(correctDepth, 0.001);
      float depthW = exp(-0.5 * depthDiff * depthDiff / (JBU_DEPTH_SIGMA * JBU_DEPTH_SIGMA));

      float w = spatialW * depthW;
      totalWeight += w;
      totalIllum += data.r * w;
    }
  }

  float bestChoice = totalWeight > 0.0 ? totalIllum / totalWeight : 0.0;

  vec3 diffuse = texture2D(sceneDiffuse, vUv).rgb;
  gl_FragColor = vec4(mix(diffuse, color, bestChoice), 1.0);

  #include <dithering_fragment>

  if (gammaCorrection) {
    gl_FragColor = LinearTosRGB_(gl_FragColor);
  }
}
