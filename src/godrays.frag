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
uniform mat4 cameraProjectionMatrixInv;
uniform mat4 cameraMatrixWorld;
uniform sampler2D shadowMap;
uniform vec2 noiseResolution;
uniform float texelSizeY;
uniform float lightCameraNear;
uniform float lightCameraFar;
uniform float density;
uniform float maxDensity;
uniform float distanceAttenuation;
uniform vec3[6] fNormals;
uniform float[6] fConstants;
uniform float raymarchSteps;
uniform mat4 premultipliedLightCameraMatrix;

#include <packing>

vec3 WorldPosFromDepth(float depth, vec2 coord) {
  float z = depth * 2.0 - 1.0;
  vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
  vec4 viewSpacePosition = cameraProjectionMatrixInv * clipSpacePosition;
  // Perspective division
  viewSpacePosition /= viewSpacePosition.w;
  vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
  return worldSpacePosition.xyz;
}

/**
 * Converts angle between light and a world position to a coordinate
 * in a point light cube shadow map
 */
vec2 cubeToUV( vec3 v ) {
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

/**
 * Projects `worldPos` onto the shadow map of a directional light and returns
 * that position in UV space.
 */
vec3 projectToShadowMap(vec3 worldPos) {
  // vec4 lightSpacePos = lightCameraProjectionMatrix * lightCameraMatrixWorldInverse * vec4(worldPos, 1.0);
  // use pre-multiplied matrix to transform to light space
  vec4 lightSpacePos = premultipliedLightCameraMatrix * vec4(worldPos, 1.0);
  lightSpacePos /= lightSpacePos.w;
  lightSpacePos = lightSpacePos * 0.5 + 0.5;
  return lightSpacePos.xyz;
}

vec2 inShadow(vec3 worldPos) {
  #if defined(IS_POINT_LIGHT)
    vec2 shadowMapUV = cubeToUV(normalize(worldPos - lightPos));
  #elif defined(IS_DIRECTIONAL_LIGHT)
    vec3 shadowMapUV = projectToShadowMap(worldPos);
    bool isOutsideShadowMap = shadowMapUV.x < 0.0 || shadowMapUV.x > 1.0 || shadowMapUV.y < 0.0 || shadowMapUV.y > 1.0 || shadowMapUV.z < 0.0 || shadowMapUV.z > 1.0;
    if (isOutsideShadowMap) {
      return vec2(1.0, 0.0);
    }
  #endif

  vec4 packedDepth = texture2D(shadowMap, shadowMapUV.xy);
  float depth = unpackRGBAToDepth(packedDepth);
  depth = lightCameraNear + (lightCameraFar - lightCameraNear) * depth;
  #if defined(IS_POINT_LIGHT)
    float lightDist = distance(worldPos, lightPos);
  #elif defined(IS_DIRECTIONAL_LIGHT)
    float lightDist = (lightCameraNear + (lightCameraFar - lightCameraNear) * shadowMapUV.z);
  #endif
  float difference = lightDist - depth;
  return vec2(float(difference > 0.0), lightDist);
}

/**
 * Calculates the signed distance from point `p` to a plane defined by
 * normal `n` and distance `h` from the origin.
 *
 * `n` must be normalized.
 */
float sdPlane(vec3 p, vec3 n, float h) {
  return dot(p, n) + h;
}

/**
 * Calculates the intersection of a ray defined by `rayOrigin` and `rayDirection`
 * with a plane defined by normal `planeNormal` and distance `planeDistance`
 *
 * Returns the distance from the ray origin to the intersection point.
 *
 * The return value will be negative if the ray does not intersect the plane.
 */
float intersectRayPlane(vec3 rayOrigin, vec3 rayDirection, vec3 planeNormal, float planeDistance) {
  float denom = dot(planeNormal, rayDirection);
  return -(sdPlane(rayOrigin, planeNormal, planeDistance) / denom);
}

void main() {
  float depth = texture2D(sceneDepth, vUv).x;

  vec3 worldPos = WorldPosFromDepth(depth, vUv);
  float inBoxDist = -10000.0;
  for (int i = 0; i < 6; i++) {
    inBoxDist = max(inBoxDist, sdPlane(cameraPos, fNormals[i], fConstants[i]));
  }
  bool cameraIsInBox = inBoxDist < 0.0;
  vec3 startPos = cameraPos;
  if (cameraIsInBox) {
    // If the ray target is outside the shadow box, move it to the nearest
    // point on the box to avoid marching through unlit space
    for(int i = 0; i < 6; i++) {
      if (sdPlane(worldPos, fNormals[i], fConstants[i]) > 0.0) {
        vec3 direction = normalize(worldPos - cameraPos);
        float t = intersectRayPlane(cameraPos, direction, fNormals[i], fConstants[i]);
        worldPos = cameraPos + t * direction;
      }
    }
  } else {
    // Find the first point where the ray intersects the shadow box (`startPos`)
    vec3 direction = normalize(worldPos - cameraPos);
    float minT = 10000.0;
    for (int i = 0; i < 6; i++) {
      float t = intersectRayPlane(cameraPos, direction, fNormals[i], fConstants[i]);
      if (t < minT && t > 0.0) {
        minT = t;
      }
    }
    if (minT == 10000.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    startPos = cameraPos + (minT + 0.001) * direction;

    // If the ray target is outside the shadow box, move it to the nearest
    // point on the box to avoid marching through unlit space
    float endInBoxDist = -10000.0;
    for (int i = 0; i < 6; i++) {
      endInBoxDist = max(endInBoxDist, sdPlane(worldPos, fNormals[i], fConstants[i]));
    }
    bool endInBox = false;
    if (endInBoxDist < 0.0) {
      endInBox = true;
    }
    if (!endInBox) {
      float minT = 10000.0;
      for (int i = 0; i < 6; i++) {
        if (sdPlane(worldPos, fNormals[i], fConstants[i]) > 0.0) {
          float t = intersectRayPlane(startPos, direction, fNormals[i], fConstants[i]);
          if (t < minT && t > 0.0) {
            minT = t;
          }
        }
      }

      if (minT < distance(worldPos, startPos)) {
        worldPos = startPos + minT * direction;
      }
    }
  }
  float illum = 0.0;

  vec4 blueNoiseSample = texture2D(blueNoise, vUv * (resolution / noiseResolution));
  float samplesFloat = round(raymarchSteps + ((raymarchSteps / 8.) + 2.) * blueNoiseSample.x);
  int samples = int(samplesFloat);
  for (int i = 0; i < samples; i++) {
    vec3 samplePos = mix(startPos, worldPos, float(i) / samplesFloat);
    vec2 shadowInfo = inShadow(samplePos);
    float shadowAmount = 1.0 - shadowInfo.x;
    illum += shadowAmount * (distance(startPos, worldPos) * density) * pow(1.0 - shadowInfo.y / lightCameraFar, distanceAttenuation);// * exp(-distanceAttenuation * shadowInfo.y);
  }
  illum /= samplesFloat;
  gl_FragColor = vec4(vec3(clamp(1.0 - exp(-illum), 0.0, maxDensity)), depth);
}
