/*
 * Code taken from this demo: https://n8python.github.io/goodGodRays/
 * By: https://github.com/n8python
 *
 * With cleanup and minor changes
 */

varying vec2 vUv;

uniform sampler2D sceneDepth;
uniform vec3 lightPos;
uniform vec3 cameraPos;
uniform vec2 resolution;
uniform mat4 cameraProjectionMatrixInv;
uniform mat4 cameraMatrixWorld;
#if defined(USE_CUBE_SHADOWMAP)
uniform samplerCube shadowMap;
#else
uniform sampler2D shadowMap;
#endif
uniform float texelSizeY;
uniform float lightCameraNear;
uniform float lightCameraFar;
uniform float near;
uniform float far;
uniform float density;
uniform float maxDensity;
uniform float distanceAttenuation;
uniform vec3[6] fNormals;
uniform float[6] fConstants;
uniform float raymarchSteps;
uniform float raymarchStepSize;
uniform float minSteps;
uniform float maxSteps;
uniform float shadowTexelWorldSize;
uniform mat4 premultipliedLightCameraMatrix;

#include <packing>

float linearize_depth(float depth, float zNear, float zFar) {
  #if defined( USE_LOGDEPTHBUF )
  float d = pow(2.0, depth * log2(zFar + 1.0)) - 1.0;
  float a = zFar / (zFar - zNear);
  float b = zFar * zNear / (zNear - zFar);
  depth = a + b / d;
  #endif

  return zNear * zFar / (zFar + depth * (zNear - zFar));
}

vec3 WorldPosFromDepth(float depth, vec2 coord) {
  #if defined( USE_LOGDEPTHBUF )
  float d = pow(2.0, depth * log2(far + 1.0)) - 1.0;
  float a = far / (far - near);
  float b = far * near / (near - far);
  depth = a + b / d;
  #endif

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
vec2 cubeToUV(vec3 v) {
  // Number of texels to avoid at the edge of each square
  vec3 absV = abs(v);
  // Intersect unit cube
  float scaleToCube = 1.0 / max(absV.x, max(absV.y, absV.z));
  absV *= scaleToCube;
  // Apply scale to avoid seams
  // two texels less per square (one texel will do for NEAREST)
  v *= scaleToCube * (1.0 - 2.0 * texelSizeY);
  // Unwrap
  // space: -1 ... 1 range for each square
  //
  // #X##        dim    := ( 4 , 2 )
  //  # #        center := ( 1 , 1 )
  vec2 planar = v.xy;
  float almostATexel = 1.5 * texelSizeY;
  float almostOne = 1.0 - almostATexel;
  if (absV.z >= almostOne) {
    if (v.z > 0.0)
      planar.x = 4.0 - v.x;
  } else if (absV.x >= almostOne) {
    float signX = sign(v.x);
    planar.x = v.z * signX + 2.0 * signX;
  } else if (absV.y >= almostOne) {
    float signY = sign(v.y);
    planar.x = v.x + 2.0 * signY + 2.0;
    planar.y = v.z * signY - 2.0;
  }
  // Transform to UV space
  // scale := 0.5 / dim
  // translate := ( center + 0.5 ) / dim
  return vec2(0.125, 0.25) * planar + vec2(0.375, 0.75);
}

/**
 * Projects worldPos onto the shadow map of a directional light and returns
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
  #if defined(USE_CUBE_SHADOWMAP)
  vec3 lightToPos = worldPos - lightPos;
  float lightDist = length(lightToPos);
  float shadowMapDepth = textureCube(shadowMap, lightToPos).r;
  float depth = lightCameraNear + (lightCameraFar - lightCameraNear) * shadowMapDepth;
  return vec2(float(lightDist > depth + 0.005), lightDist);
  #else

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
  #if defined( USE_UNPACKED_DEPTH )
  #if defined(IS_DIRECTIONAL_LIGHT)
  float depth = packedDepth.x;
  #else
  // packing uses: gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
  float depth = 1. - packedDepth.x;
  #endif
  #else
  float depth = unpackRGBAToDepth(packedDepth);
  #endif

  depth = lightCameraNear + (lightCameraFar - lightCameraNear) * depth;
  #if defined(IS_POINT_LIGHT)
  float lightDist = distance(worldPos, lightPos);
  #elif defined(IS_DIRECTIONAL_LIGHT)
  float lightDist = (lightCameraNear + (lightCameraFar - lightCameraNear) * shadowMapUV.z);
  #endif
  float difference = lightDist - depth;
  return vec2(float(difference > 0.0), lightDist);
  #endif
}

/**
 * Calculates the signed distance from point p to a plane defined by
 * normal n and distance h from the origin.
 *
 * n must be normalized.
 */
float sdPlane(vec3 p, vec3 n, float h) {
  return dot(p, n) + h;
}

void main() {
  float depth = texture2D(sceneDepth, vUv).x;
  float linearDepth = linearize_depth(depth, near, far);

  vec3 worldPos = WorldPosFromDepth(depth, vUv);
  vec3 direction = normalize(worldPos - cameraPos);
  float distToTarget = distance(worldPos, cameraPos);

  // Ray-convex intersection via slab method.
  // For each frustum plane, classify the intersection as entry or exit based
  // on whether the ray crosses from outside to inside or vice versa.
  // The valid segment is [max of entries, min of exits].
  float tEntry = 0.0;
  float tExit = distToTarget;
  bool missed = false;
  for (int i = 0; i < 6; i++) {
    float denom = dot(fNormals[i], direction);
    float dist = sdPlane(cameraPos, fNormals[i], fConstants[i]);

    if (abs(denom) < 1e-6) {
      // Ray parallel to plane — miss if camera is outside this plane
      if (dist > 0.0) {
        missed = true;
        break;
      }
    } else {
      float t = -dist / denom;
      if (denom < 0.0) {
        // Entry: ray crossing from outside to inside
        tEntry = max(tEntry, t);
      } else {
        // Exit: ray crossing from inside to outside
        tExit = min(tExit, t);
      }
    }
  }

  if (missed || tEntry >= tExit) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, linearDepth);
    return;
  }

  // Small offset to avoid self-intersection when camera is outside the volume
  float startOffset = tEntry > 0.0 ? 0.001 : 0.0;
  vec3 startPos = cameraPos + (tEntry + startOffset) * direction;
  worldPos = cameraPos + tExit * direction;
  float illum = 0.0;
  float rayLength = distance(startPos, worldPos);
  float densityFactor = rayLength * density;

  float baseSteps;
  if (raymarchStepSize > 0.0) {
    float effectiveStepSize = max(raymarchStepSize, shadowTexelWorldSize * 0.5);
    baseSteps = clamp(rayLength / effectiveStepSize, minSteps, maxSteps);
  } else {
    baseSteps = raymarchSteps;
  }

  float noise = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
  float samplesFloat = round(baseSteps + ((baseSteps / 8.0) + 2.0) * noise);
  int samples = int(samplesFloat);
  float earlyOutThreshold = -log(1.0 - maxDensity) * samplesFloat;
  int stepsTaken = samples;
  for (int i = 0; i < samples; i++) {
    vec3 samplePos = mix(startPos, worldPos, float(i) / samplesFloat);
    vec2 shadowInfo = inShadow(samplePos);
    float shadowAmount = 1.0 - shadowInfo.x;
    illum += shadowAmount * densityFactor * pow(1.0 - shadowInfo.y / lightCameraFar, distanceAttenuation);
    if (illum > earlyOutThreshold) {
      stepsTaken = i + 1;
      break;
    }
  }
  illum /= samplesFloat;

  #if defined(DEBUG_STEPS)
  float t = clamp(float(stepsTaken) / 150.0, 0.0, 1.0);
  gl_FragColor = vec4(0.0, t, 0.0, linearDepth);
  #else
  gl_FragColor = vec4(vec3(clamp(1.0 - exp(-illum), 0.0, maxDensity)), linearDepth);
  #endif
}
