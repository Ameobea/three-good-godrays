/*
 * Code taken from this demo: https://n8python.github.io/goodGodRays/
 * By: https://github.com/n8python
 *
 * With cleanup and minor changes
 */

varying vec2 vUv;

uniform sampler2D sceneDepth;
uniform sampler2D blueNoise;
uniform vec3 lightPos;
uniform vec3 cameraPos;
uniform vec2 resolution;
uniform mat4 projectionMatrixInv;
uniform mat4 viewMatrixInv;
uniform sampler2D depthCube;
uniform vec2 noiseResolution;
uniform float mapSize;
uniform float pointLightCameraNear;
uniform float pointLightCameraFar;
uniform float density;
uniform float maxDensity;
uniform float distanceAttenuation;

#include <packing>

vec3 WorldPosFromDepth(float depth, vec2 coord) {
  float z = depth * 2.0 - 1.0;
  vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
  vec4 viewSpacePosition = projectionMatrixInv * clipSpacePosition;
  // Perspective division
  viewSpacePosition /= viewSpacePosition.w;
  vec4 worldSpacePosition = viewMatrixInv * viewSpacePosition;
  return worldSpacePosition.xyz;
}

float linearize_depth(float d,float zNear,float zFar) {
  return zNear * zFar / (zFar + d * (zNear - zFar));
}

vec2 cubeToUV( vec3 v, float texelSizeY ) {
  // Number of texels to avoid at the edge of each square
  vec3 absV = abs( v );
  // Intersect unit cube
  float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
  absV *= scaleToCube;
  // Apply scale to avoid seams
  // two texels less per square (one texel will do for NEAREST)
  v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
  // Unwrap
  // space: -1 ... 1 range for each square
  //
  // #X##        dim    := ( 4 , 2 )
  //  # #        center := ( 1 , 1 )
  vec2 planar = v.xy;
  float almostATexel = 1.5 * texelSizeY;
  float almostOne = 1.0 - almostATexel;
  if ( absV.z >= almostOne ) {
    if ( v.z > 0.0 )
      planar.x = 4.0 - v.x;
  } else if ( absV.x >= almostOne ) {
    float signX = sign( v.x );
    planar.x = v.z * signX + 2.0 * signX;
  } else if ( absV.y >= almostOne ) {
    float signY = sign( v.y );
    planar.x = v.x + 2.0 * signY + 2.0;
    planar.y = v.z * signY - 2.0;
  }
  // Transform to UV space
  // scale := 0.5 / dim
  // translate := ( center + 0.5 ) / dim
  return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
}

float inShadow(vec3 worldPos) {
  vec4 packedDepth = texture2D(depthCube, cubeToUV(normalize(worldPos - lightPos), 1.0 / (mapSize * 2.0)));
  float depth = unpackRGBAToDepth(packedDepth);
  depth = pointLightCameraNear + (pointLightCameraFar - pointLightCameraNear) * depth;
  float difference = distance(worldPos, lightPos) - depth;
  return float(difference > 0.01);
}

void main() {
  float depth = texture2D(sceneDepth, vUv).x;
  vec4 blueNoiseSample = texture2D(blueNoise, vUv * (resolution / noiseResolution));

  vec3 worldPos = WorldPosFromDepth(depth, vUv);
  float illum = 0.0;

  float samples = round(60.0 + 8.0 * blueNoiseSample.x);
  for (float i = 0.0; i < samples; i++) {
    vec3 samplePos = mix(cameraPos, worldPos, i / samples);
    illum += (1.0 - inShadow(samplePos)) * (distance(cameraPos, worldPos) * density) * exp(-distanceAttenuation * distance(worldPos, lightPos));
  }
  illum /= samples;
  gl_FragColor = vec4(vec3(clamp((1.0 - exp(-illum)), 0.0, maxDensity)), depth);
}
