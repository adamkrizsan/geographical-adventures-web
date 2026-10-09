/**
 * GLSL chunks ported from the upstream shader library.
 *
 * Written in a GLSL1 style (`varying`, `texture2D`, `gl_FragColor`); materials set
 * `glslVersion: THREE.GLSL3`, and three.js maps those tokens onto ES 3.00. That gives us
 * `textureLod`, `dFdx`/`dFdy` and integer-safe sampling used by the original code.
 *
 * Sources:
 *   Assets/Scripts/Shader Common/GeoMath.hlsl
 *   Assets/Scripts/Shader Common/Triplanar.hlsl
 */

export const GEO_MATH = /* glsl */ `
#define PI 3.141592653589793

vec2 pointToLongitudeLatitude(vec3 p) {
  return vec2(atan(p.x, p.z), asin(clamp(p.y, -1.0, 1.0)));
}

vec2 longitudeLatitudeToUV(vec2 longLat) {
  return vec2((longLat.x / PI + 1.0) * 0.5, longLat.y / PI + 0.5);
}

vec2 pointToUV(vec3 p) {
  return longitudeLatitudeToUV(pointToLongitudeLatitude(p));
}

// Manual mip selection to avoid a mip seam where the equirectangular map wraps on x.
float calculateGeoMipLevel(vec2 texCoord, vec2 texSize) {
  vec2 dx, dy;
  if (texCoord.x < 0.75 && texCoord.x > 0.25) {
    dx = dFdx(texCoord);
    dy = dFdy(texCoord);
  } else {
    vec2 s = texCoord + vec2(0.5, 0.0);
    dx = dFdx(s - floor(s));
    dy = dFdy(s - floor(s));
  }
  float mipMapWeight = 0.5;
  dx *= texSize * mipMapWeight;
  dy *= texSize * mipMapWeight;
  float maxSqrLength = max(dot(dx, dx), dot(dy, dy));
  float mipLevel = 0.5 * log2(max(maxSqrLength, 1e-8));
  return min(8.0, mipLevel);
}

float calculateSpecular(vec3 normal, vec3 viewDir, vec3 dirToSun, float smoothness) {
  float specularAngle = acos(clamp(dot(normalize(dirToSun - viewDir), normal), -1.0, 1.0));
  float specularExponent = specularAngle / max(smoothness, 0.001);
  return exp(-max(0.0, specularExponent) * specularExponent);
}
`;

export const TRIPLANAR = /* glsl */ `
vec4 triplanar(vec3 vertPos, vec3 normal, float scale, sampler2D tex, vec2 offset) {
  vec3 scaledPos = vertPos / scale;
  vec4 colX = texture2D(tex, scaledPos.zy + offset);
  vec4 colY = texture2D(tex, scaledPos.xz + offset);
  vec4 colZ = texture2D(tex, scaledPos.xy + offset);
  vec3 blendWeight = normal * normal;
  blendWeight /= dot(blendWeight, vec3(1.0));
  return colX * blendWeight.x + colY * blendWeight.y + colZ * blendWeight.z;
}

vec3 blend_rnm(vec3 n1, vec3 n2) {
  n1.z += 1.0;
  n2.xy = -n2.xy;
  return n1 * dot(n1, n2) / n1.z - n2;
}

vec3 unpackScaleNormal(vec4 packedNormal, float normalScale) {
  vec2 xy = (packedNormal.wy * 2.0 - 1.0) * normalScale;
  float z = sqrt(1.0 - clamp(dot(xy, xy), 0.0, 1.0));
  return vec3(xy, z);
}

vec3 triplanarNormal(
  sampler2D normalMap, vec3 pos, vec3 normal, float scale, vec2 offset, float strength
) {
  vec3 absNormal = abs(normal);
  vec3 blendWeight = clamp(pow(normal, vec3(4.0)), 0.0, 1.0);
  blendWeight /= dot(blendWeight, vec3(1.0));

  vec2 uvX = pos.zy * scale + offset;
  vec2 uvY = pos.xz * scale + offset;
  vec2 uvZ = pos.xy * scale + offset;

  vec3 tangentNormalX = unpackScaleNormal(texture2D(normalMap, uvX), strength);
  vec3 tangentNormalY = unpackScaleNormal(texture2D(normalMap, uvY), strength);
  vec3 tangentNormalZ = unpackScaleNormal(texture2D(normalMap, uvZ), strength);

  tangentNormalX = blend_rnm(vec3(normal.zy, absNormal.x), tangentNormalX);
  tangentNormalY = blend_rnm(vec3(normal.xz, absNormal.y), tangentNormalY);
  tangentNormalZ = blend_rnm(vec3(normal.xy, absNormal.z), tangentNormalZ);

  vec3 axisSign = sign(normal);
  tangentNormalX.z *= axisSign.x;
  tangentNormalY.z *= axisSign.y;
  tangentNormalZ.z *= axisSign.z;

  return normalize(
    tangentNormalX.zyx * blendWeight.x +
    tangentNormalY.xzy * blendWeight.y +
    tangentNormalZ.xyz * blendWeight.z
  );
}

// Variant that also returns the raw blended tangent-space normal (used by the ocean for
// refraction offset).
vec3 triplanarNormalTang(
  sampler2D normalMap, vec3 pos, vec3 normal, float scale, vec2 offset, float strength,
  out vec3 tangentNormal
) {
  vec3 absNormal = abs(normal);
  vec3 blendWeight = clamp(pow(normal, vec3(4.0)), 0.0, 1.0);
  blendWeight /= dot(blendWeight, vec3(1.0));

  vec2 uvX = pos.zy * scale + offset;
  vec2 uvY = pos.xz * scale + offset;
  vec2 uvZ = pos.xy * scale + offset;

  vec3 tangentNormalX = unpackScaleNormal(texture2D(normalMap, uvX), strength);
  vec3 tangentNormalY = unpackScaleNormal(texture2D(normalMap, uvY), strength);
  vec3 tangentNormalZ = unpackScaleNormal(texture2D(normalMap, uvZ), strength);

  tangentNormal = tangentNormalX * blendWeight.x + tangentNormalY * blendWeight.y + tangentNormalZ * blendWeight.z;

  tangentNormalX = blend_rnm(vec3(normal.zy, absNormal.x), tangentNormalX);
  tangentNormalY = blend_rnm(vec3(normal.xz, absNormal.y), tangentNormalY);
  tangentNormalZ = blend_rnm(vec3(normal.xy, absNormal.z), tangentNormalZ);

  vec3 axisSign = sign(normal);
  tangentNormalX.z *= axisSign.x;
  tangentNormalY.z *= axisSign.y;
  tangentNormalZ.z *= axisSign.z;

  return normalize(
    tangentNormalX.zyx * blendWeight.x +
    tangentNormalY.xzy * blendWeight.y +
    tangentNormalZ.xyz * blendWeight.z
  );
}
`;

export const TERRAIN_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vShadowCoord;
uniform mat4 uShadowMatrix;
uniform float uShadowNormalBias;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
  vNormal = worldNormal;
  // Normal bias (upstream Light.m_NormalBias = 0.2) offsets the shadow lookup along the
  // outward surface normal to avoid self-shadowing on the normal-mapped terrain.
  vec3 unitPos = normalize(worldPos.xyz);
  vec3 outward = dot(worldNormal, unitPos) < 0.0 ? -worldNormal : worldNormal;
  vShadowCoord = uShadowMatrix * vec4(worldPos.xyz + outward * uShadowNormalBias, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const TERRAIN_FRAGMENT = /* glsl */ `
${GEO_MATH}
${TRIPLANAR}

#include <packing>

layout(location = 0) out vec4 fragColor;

uniform sampler2D uColWest, uColEast, uNormalWest, uNormalEast, uLightMap, uLakeMask, uWaveNormalA;
uniform vec2 uColTexSize;
uniform vec3 uSunDir;
uniform vec3 uAmbientNight, uCityLightAmbient, uFresnelCol, uShadowEdgeCol, uShadowInnerCol;
uniform float uShadowStrength, uContrast, uBrightnessAdd, uBrightnessMul, uSpecular, uWaveNormalScale, uWaveStrength;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowEnabled;
uniform float uShadowIntensity;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vShadowCoord;

float getShadow() {
  if (uShadowEnabled < 0.5) return 1.0;
  vec3 coord = vShadowCoord.xyz / vShadowCoord.w;
  if (coord.z > 1.0 || coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) return 1.0;
  float bias = 0.0012;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float visibility = 0.0;
  // Soft shadows (upstream Light.m_Shadows.m_Type = Soft): a 5x5 PCF kernel rather than a
  // hard 1-texel test, which keeps grazing-sun terrain shadows from reading as cut-out.
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      float depth = texture2D(uShadowMap, coord.xy + vec2(float(x), float(y)) * texel).x;
      visibility += (coord.z - bias <= depth) ? 1.0 : 0.0;
    }
  }
  visibility /= 25.0;
  // Upstream Light shadow strength (m_Strength = 0.8) is applied inside LIGHT_ATTENUATION.
  return mix(1.0, visibility, uShadowIntensity);
}

void main() {
  vec3 pointOnUnitSphere = normalize(vWorldPos);
  vec2 texCoord = pointToUV(pointOnUnitSphere);
  float lightMap = texture2D(uLightMap, texCoord).r;
  float lakeMask = texture2D(uLakeMask, texCoord).r;

  vec2 tWest = vec2(texCoord.x * 2.0, texCoord.y);
  vec2 tEast = vec2((texCoord.x - 0.5) * 2.0, texCoord.y);
  float mipWest = calculateGeoMipLevel(tWest, uColTexSize);
  float mipEast = calculateGeoMipLevel(tEast, uColTexSize);
  // Blend across the lon-0 tile seam (the west/east map halves don't line up pixel-perfect),
  // otherwise a thin dark line is visible along the Greenwich meridian.
  float seamBlend = smoothstep(-0.0025, 0.0025, texCoord.x - 0.5);
  vec3 unlitTerrainCol = mix(
    textureLod(uColWest, tWest, mipWest).rgb,
    textureLod(uColEast, tEast, mipEast).rgb,
    seamBlend
  );
  vec3 detailNormal = mix(
    textureLod(uNormalWest, tWest, mipWest).rgb,
    textureLod(uNormalEast, tEast, mipEast).rgb,
    seamBlend
  );

  detailNormal = normalize(detailNormal * 2.0 - 1.0);
  // The normal map stores object-space surface normals. Transform into the (Z-mirrored)
  // world space with the same flip the mesh normals get, and use it as the terrain normal.
  detailNormal.z = -detailNormal.z;
  vec3 worldNormal = normalize(detailNormal);

  vec3 dirToSun = normalize(uSunDir);
  vec3 viewDir = normalize(vWorldPos - cameraPosition);

  vec3 waveA = triplanarNormal(uWaveNormalA, vWorldPos, pointOnUnitSphere, uWaveNormalScale, vec2(0.0), uWaveStrength);
  float lakeSpecular = calculateSpecular(waveA, viewDir, dirToSun, uSpecular) * lakeMask;

  float shadows = getShadow();
  vec3 shadowCol = mix(uShadowEdgeCol, uShadowInnerCol, clamp((1.0 - shadows) * 1.5, 0.0, 1.0));
  shadows = mix(1.0, shadows, uShadowStrength);

  float fakeLighting = pow(max(dot(worldNormal, pointOnUnitSphere), 0.0), 3.0);
  float nightShading = fakeLighting;

  float greyscale = dot(unlitTerrainCol, vec3(0.299, 0.587, 0.114));
  vec3 nightCol = (pow(vec3(max(greyscale, 0.0)), vec3(0.67)) * nightShading + nightShading * 0.3)
    * mix(uAmbientNight * 0.1, uCityLightAmbient, clamp(lightMap, 0.0, 1.0));
  float fresnel = clamp(1.5 * pow(1.0 + dot(viewDir, worldNormal), 5.0), 0.0, 1.0);
  nightCol += fresnel * uFresnelCol;
  float nightT = smoothstep(-0.25, 0.25, dot(pointOnUnitSphere, dirToSun));

  vec3 shading = vec3(clamp(dot(worldNormal, dirToSun) + uBrightnessAdd, 0.0, 1.0) * uBrightnessMul);
  vec3 terrainCol = unlitTerrainCol * shading + lakeSpecular;
  terrainCol = mix(terrainCol, shadowCol, 1.0 - shadows);
  terrainCol = mix(vec3(0.5), terrainCol, uContrast);
  terrainCol *= mix(fakeLighting, 1.0, 0.5);

  vec3 finalTerrainCol = mix(nightCol, terrainCol, nightT);
  fragColor = vec4(finalTerrainCol, 1.0);
}
`;

export const OCEAN_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vShadowCoord;
uniform mat4 uShadowMatrix;
uniform float uShadowNormalBias;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
  vNormal = worldNormal;
  vec3 unitPos = normalize(worldPos.xyz);
  vec3 outward = dot(worldNormal, unitPos) < 0.0 ? -worldNormal : worldNormal;
  vShadowCoord = uShadowMatrix * vec4(worldPos.xyz + outward * uShadowNormalBias, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const OCEAN_FRAGMENT = /* glsl */ `
${GEO_MATH}
${TRIPLANAR}

#include <packing>

layout(location = 0) out vec4 fragColor;

uniform sampler2D uOceanCol, uNoise, uWaveNormalA, uWaveNormalB, uFoamDistanceMap;
uniform vec2 uOceanColTexSize;
uniform vec3 uSunDir;
uniform vec3 uAmbient, uFresnelCol, uFoamColour;
uniform float uTime;
uniform float uSpecularSmoothness, uWaveNormalScale, uWaveStrength, uWaveSpeed, uRefraction, uShadowStrength;
uniform float uFresnelWeight, uFresnelPower;
uniform float uFoamDst, uFoamSpeed, uFoamFrequency, uFoamWidth, uFoamEdgeBlend, uShoreFoamDst;
uniform float uFoamNoiseSpeed, uFoamNoiseStrength, uFoamNoiseScale, uFoamMaskScale, uFoamMaskBlend;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowEnabled;
uniform float uShadowIntensity;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vShadowCoord;

float getShadow() {
  if (uShadowEnabled < 0.5) return 1.0;
  vec3 coord = vShadowCoord.xyz / vShadowCoord.w;
  if (coord.z > 1.0 || coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) return 1.0;
  float bias = 0.0012;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float visibility = 0.0;
  // Soft shadows (upstream Light.m_Shadows.m_Type = Soft): a 5x5 PCF kernel rather than a
  // hard 1-texel test, which keeps grazing-sun terrain shadows from reading as cut-out.
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      float depth = texture2D(uShadowMap, coord.xy + vec2(float(x), float(y)) * texel).x;
      visibility += (coord.z - bias <= depth) ? 1.0 : 0.0;
    }
  }
  visibility /= 25.0;
  // Upstream Light shadow strength (m_Strength = 0.8) is applied inside LIGHT_ATTENUATION.
  return mix(1.0, visibility, uShadowIntensity);
}

vec3 calculateWaveNormals(vec3 pos, vec3 sphereNormal, out vec3 tang) {
  float noise = triplanar(sphereNormal, sphereNormal, 0.15, uNoise, vec2(0.0)).r;

  float waveSpeed = 0.35 * uWaveSpeed;
  float tx = uTime * 0.05; // Unity _Time.x
  vec2 waveOffsetA = vec2(tx * waveSpeed, tx * waveSpeed * 0.8);
  vec2 waveOffsetB = vec2(tx * waveSpeed * -0.8, tx * waveSpeed * -0.5);

  vec3 waveA = triplanarNormal(uWaveNormalA, pos, sphereNormal, uWaveNormalScale, waveOffsetA, uWaveStrength);
  vec3 waveB = triplanarNormal(uWaveNormalA, pos, sphereNormal, uWaveNormalScale * 0.9, waveOffsetA + vec2(0.3, 0.7), uWaveStrength);
  return triplanarNormalTang(uWaveNormalB, pos, mix(waveA, waveB, noise), uWaveNormalScale * 1.25, waveOffsetB, uWaveStrength, tang);
}

vec4 calculateFoam(vec2 uv, vec3 pointOnUnitSphere, vec3 viewDir) {
  float dstFromShore = texture2D(uFoamDistanceMap, uv).r;
  dstFromShore = clamp(dstFromShore / uFoamDst, 0.0, 1.0);

  float tx = uTime * 0.05; // Unity _Time.x
  float ty = uTime;        // Unity _Time.y

  vec2 noiseOffset = vec2(0.0617, 0.0314) * uFoamNoiseSpeed * tx;
  float foamNoise = triplanar(pointOnUnitSphere, pointOnUnitSphere, uFoamNoiseScale * 0.1, uNoise, noiseOffset).r;
  foamNoise = (foamNoise - 0.5) * uFoamNoiseStrength * dstFromShore;

  vec2 foamMaskOffset = vec2(-0.021, 0.07) * uFoamNoiseSpeed * tx;
  float foamMask = triplanar(pointOnUnitSphere, pointOnUnitSphere, uFoamMaskScale * 0.1, uNoise, foamMaskOffset).r;
  float threshold = mix(0.375, 0.55, clamp(dstFromShore, 0.0, 1.0));
  foamMask = smoothstep(threshold, threshold + uFoamMaskBlend * 0.01, foamMask);

  float foamStrength = sin(dstFromShore * uFoamFrequency - ty * uFoamSpeed + foamNoise);
  foamStrength = clamp(smoothstep(uFoamWidth * 0.1 + uFoamEdgeBlend * 0.1, uFoamWidth * 0.1, foamStrength + 1.0), 0.0, 1.0) * foamMask;
  float foamAtShore = smoothstep(uShoreFoamDst + 0.1, uShoreFoamDst, dstFromShore);
  foamStrength = clamp(foamStrength + foamAtShore, 0.0, 1.0);
  foamStrength *= 1.0 - smoothstep(0.7, 1.0, dstFromShore);

  float angleStrength = 1.0 - smoothstep(-0.53, -0.13, dot(viewDir, pointOnUnitSphere));
  foamStrength = clamp(foamStrength * angleStrength, 0.0, 1.0);

  vec3 foamColour = mix(vec3(1.0), uFoamColour, dstFromShore);
  return vec4(foamColour, foamStrength);
}

void main() {
  vec3 pointOnUnitSphere = normalize(vWorldPos);
  vec3 sphereNormal = pointOnUnitSphere;
  vec2 texCoord = pointToUV(pointOnUnitSphere);
  float mipLevel = calculateGeoMipLevel(texCoord, uOceanColTexSize);

  float shadows = getShadow();
  vec3 dirToSun = normalize(uSunDir);
  vec3 viewDir = normalize(vWorldPos - cameraPosition);

  vec3 tang;
  vec3 waveNormal = calculateWaveNormals(vWorldPos, sphereNormal, tang);

  vec2 oceanRefractionTexCoord = texCoord + tang.xy * 0.0005 * uRefraction;
  vec3 oceanCol = textureLod(uOceanCol, oceanRefractionTexCoord, mipLevel).rgb;

  float specularHighlight = clamp(calculateSpecular(waveNormal, viewDir, dirToSun, uSpecularSmoothness), 0.0, 1.0);
  float specularStrength = clamp(shadows * 5.0, 0.0, 1.0);
  specularStrength *= smoothstep(0.4, 0.5, shadows);
  specularHighlight *= specularStrength;

  float shading = dot(sphereNormal, dirToSun) * 0.5 + 0.5;
  shading = shading * shading;

  float ripple = clamp(smoothstep(-0.53, 0.54, dot(waveNormal, viewDir)), 0.0, 1.0);
  oceanCol += ripple * 0.15;

  oceanCol = clamp(oceanCol * (1.0 - specularHighlight) * shading, 0.0, 1.0) + specularHighlight * vec3(1.0);

  vec4 foam = calculateFoam(texCoord, pointOnUnitSphere, viewDir);
  oceanCol = mix(oceanCol, foam.rgb, foam.a);

  float nightT = clamp(dot(sphereNormal, -dirToSun), 0.0, 1.0);
  shadows = mix(shadows, 0.0, smoothstep(0.2, 0.3, nightT));
  oceanCol *= mix(1.0, shadows, uShadowStrength);
  oceanCol = clamp(oceanCol + uAmbient * 0.1, 0.0, 1.0);

  float fresnel = clamp(uFresnelWeight * pow(1.0 + dot(viewDir, pointOnUnitSphere), uFresnelPower), 0.0, 1.0);
  oceanCol += fresnel * uFresnelCol;

  fragColor = vec4(oceanCol, 1.0);
}
`;
