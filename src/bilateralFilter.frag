/**
 * Adapted from: https://www.shadertoy.com/view/4dfGDH
 */

uniform sampler2D tInput;
uniform vec2 resolution;
uniform float bSigma;

varying vec2 vUv;

#if (KSIZE_ENUM == 0)
  #define KSIZE 2
  #define MSIZE 5
  const float kernel[MSIZE] = float[MSIZE](0., 0.24196934138575799, 0.39894, 0.24196934138575799, 0.);
#elif (KSIZE_ENUM == 1)
  #define KSIZE 3
  #define MSIZE 7
  const float kernel[MSIZE] = float[MSIZE](0., 0.39104045872899694, 0.3969502784491287, 0.39894, 0.3969502784491287, 0.39104045872899694, 0.);
#elif (KSIZE_ENUM == 2)
  #define KSIZE 4
  #define MSIZE 9
  const float kernel[MSIZE] = float[MSIZE](0., 0.3813856354024969, 0.39104045872899694, 0.3969502784491287, 0.39894, 0.3969502784491287, 0.39104045872899694, 0.3813856354024969, 0.);
#elif (KSIZE_ENUM == 3)
  #define KSIZE 5
  #define MSIZE 11
  const float kernel[MSIZE] = float[MSIZE](0., 0.03682680352274845, 0.03813856354024969, 0.039104045872899694, 0.03969502784491287, 0.039894, 0.03969502784491287, 0.039104045872899694, 0.03813856354024969, 0.03682680352274845, 0.);
#elif (KSIZE_ENUM == 4)
  #define KSIZE 6
  #define MSIZE 13
  const float kernel[MSIZE] = float[MSIZE](0., 0.035206331431709856, 0.03682680352274845, 0.03813856354024969, 0.039104045872899694, 0.03969502784491287, 0.039894, 0.03969502784491287, 0.039104045872899694, 0.03813856354024969, 0.03682680352274845, 0.035206331431709856, 0.);
#elif (KSIZE_ENUM == 5)
  #define KSIZE 7
  #define MSIZE 15
  const float kernel[MSIZE] = float[MSIZE](0.031225216, 0.033322271, 0.035206333, 0.036826804, 0.038138565, 0.039104044, 0.039695028, 0.039894000, 0.039695028, 0.039104044, 0.038138565, 0.036826804, 0.035206333, 0.033322271, 0.031225216);
#endif

float normpdf(in float x, in float sigma) {
	return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
}

float normpdf3(in vec3 v, in float sigma) {
	return 0.39894 * exp(-0.5 * dot(v, v) / (sigma * sigma)) / sigma;
}

void main() {
  vec3 c = texture(tInput, vUv).rgb;
  ivec2 fragCoord = ivec2(vUv * resolution);
  vec3 finalColor = vec3(0.);

  float bZ = 1.0 / normpdf(0.0, bSigma);
  float totalFactor = 0.;
  for (int i = -KSIZE; i <= KSIZE; ++i) {
    for (int j = -KSIZE; j <= KSIZE; ++j) {
      vec3 cc = texelFetch(tInput, fragCoord + ivec2(i, j), 0).rgb;
      float factor = normpdf3(cc - c, bSigma) * bZ * kernel[KSIZE + j] * kernel[KSIZE + i];
      totalFactor += factor;
      finalColor += factor * cc;
    }
  }

  gl_FragColor = vec4(finalColor / totalFactor, 1.);
}
