import * as THREE from 'three';

/**
 * Physically-based atmosphere, ported from Sebastian Lague's `AtmosphereEffect`
 * (itself based on Hillaire's EGSR2020 sky model).
 *
 * Sources:
 *   Assets/Post Processing/Effects/Atmosphere/Shader Common/AtmosphereCommon.hlsl
 *   .../Shaders/DrawSky.shader
 *   .../LUT Compute/TransmittanceDepthLUT.compute
 * Parameter values from Assets/Post Processing/Effects/Atmosphere/Atmosphere.asset.
 */

export const ATMOSPHERE = {
  planetRadius: 149.5,
  atmosphereThickness: 110,
  get atmosphereRadius(): number {
    return this.planetRadius + this.atmosphereThickness;
  },
  rayleighCoefficients: new THREE.Vector3(
    Math.pow(748.5 / 639.5, 4),
    Math.pow(748.5 / 526, 4),
    Math.pow(748.5 / 441.8, 4),
  ),
  rayleighDensityAvg: 0.086,
  mieCoefficient: 0.38,
  mieDensityAvg: 0.08,
  mieAbsorption: 0.11,
  ozonePeakDensityAltitude: 0.12,
  ozoneDensityFalloff: 3.7,
  ozoneAbsorption: new THREE.Vector3(-3, 3.12, 0.02).multiplyScalar(0.4 * 0.1),
  sunDiscSize: 1.15,
  sunDiscBlurA: 32.95,
  sunDiscBlurB: 3.1,
  intensity: 1.31,
  contrast: 1.45,
  whitePoint: 1,
  skyTransmittanceWeight: 0.429,
  numSteps: 64,
} as const;

/** GLSL port of AtmosphereCommon.hlsl (+ DrawSky's tonemap/sun-disc helpers). */
export const ATMOSPHERE_GLSL = /* glsl */ `
#define PI 3.14159265359

uniform float atmosphereThickness;
uniform float atmosphereRadius;
uniform float planetRadius;
uniform vec3 rayleighCoefficients;
uniform float rayleighDensityAvg;
uniform float mieCoefficient;
uniform float mieDensityAvg;
uniform float mieAbsorption;
uniform float ozonePeakDensityAltitude;
uniform float ozoneDensityFalloff;
uniform vec3 ozoneAbsorption;
uniform vec3 dirToSun;

struct ScatteringParameters { vec3 rayleigh; float mie; vec3 extinction; };
struct ScatteringResult { vec3 luminance; vec3 transmittance; };

ScatteringParameters getScatteringValues(vec3 rayPos) {
  ScatteringParameters s;
  float height = length(rayPos) - planetRadius;
  float height01 = clamp(height / atmosphereThickness, 0.0, 1.0);

  float rayleighDensity = exp(-height01 / rayleighDensityAvg);
  float mieDensity = exp(-height01 / mieDensityAvg);
  float ozoneDensity = clamp(1.0 - abs(ozonePeakDensityAltitude - height01) * ozoneDensityFalloff, 0.0, 1.0);

  s.mie = mieCoefficient * mieDensity;
  s.rayleigh = rayleighCoefficients * rayleighDensity;
  s.extinction = s.mie + mieAbsorption * mieDensity + s.rayleigh + ozoneAbsorption * ozoneDensity;
  return s;
}

float getMiePhase(float cosTheta) {
  const float g = 0.8;
  const float scale = 3.0 / (8.0 * PI);
  float num = (1.0 - g * g) * (1.0 + cosTheta * cosTheta);
  float denom = (2.0 + g * g) * pow(abs(1.0 + g * g - 2.0 * g * cosTheta), 1.5);
  return scale * num / denom;
}

float getRayleighPhase(float cosTheta) {
  const float k = 3.0 / (16.0 * PI);
  return k * (1.0 + cosTheta * cosTheta);
}

// Returns (dstToSphere, dstThroughSphere)
vec2 raySphere(vec3 sphereCentre, float sphereRadius, vec3 rayOrigin, vec3 rayDir) {
  vec3 offset = rayOrigin - sphereCentre;
  float a = 1.0;
  float b = 2.0 * dot(offset, rayDir);
  float c = dot(offset, offset) - sphereRadius * sphereRadius;
  float d = b * b - 4.0 * a * c;
  if (d > 0.0) {
    float s = sqrt(d);
    float dstToSphereNear = max(0.0, (-b - s) / (2.0 * a));
    float dstToSphereFar = (-b + s) / (2.0 * a);
    if (dstToSphereFar >= 0.0) {
      return vec2(dstToSphereNear, dstToSphereFar - dstToSphereNear);
    }
  }
  return vec2(1e30, 0.0);
}

float rayIntersectSphere(vec3 rayPos, vec3 rayDir, float radius) {
  float b = dot(rayPos, rayDir);
  float c = dot(rayPos, rayPos) - radius * radius;
  if (c > 0.0 && b > 0.0) return -1.0;
  float discr = b * b - c;
  if (discr < 0.0) return -1.0;
  if (discr > b * b) return -b + sqrt(discr);
  return -b - sqrt(discr);
}

vec3 getSunTransmittance(vec3 pos, vec3 sunDir) {
  const int sunTransmittanceSteps = 40;
  vec2 atmoHitInfo = raySphere(vec3(0.0), atmosphereRadius, pos, sunDir);
  float rayLength = atmoHitInfo.y;
  float stepSize = rayLength / float(sunTransmittanceSteps);
  vec3 transmittance = vec3(1.0);
  vec3 opticalDepth = vec3(0.0);
  for (int i = 0; i < sunTransmittanceSteps; i++) {
    pos += sunDir * stepSize;
    ScatteringParameters scattering = getScatteringValues(pos);
    transmittance *= exp(-scattering.extinction / atmosphereThickness * stepSize);
    opticalDepth += scattering.extinction;
  }
  return exp(-(opticalDepth / atmosphereThickness * stepSize));
}

vec3 getSunTransmittanceLUT(sampler2D lut, vec3 pos, vec3 dir) {
  float dstFromCentre = length(pos);
  float height = dstFromCentre - planetRadius;
  float height01 = clamp(height / atmosphereThickness, 0.0, 1.0);
  float uvX = 1.0 - (dot(pos / dstFromCentre, dir) * 0.5 + 0.5);
  return textureLod(lut, vec2(uvX, height01), 0.0).rgb;
}

ScatteringResult raymarch(vec3 rayPos, vec3 rayDir, float rayLength, int numSteps, sampler2D transmittanceLUT, float earthShadowRadius) {
  vec3 luminance = vec3(0.0);
  vec3 transmittance = vec3(1.0);
  float stepSize = rayLength / float(numSteps);
  float scaledStepSize = stepSize / atmosphereThickness;
  float cosTheta = dot(rayDir, dirToSun);
  float rayleighPhaseValue = 1.0;
  float miePhase = getMiePhase(cosTheta);

  for (int stepIndex = 0; stepIndex < numSteps; stepIndex++) {
    ScatteringParameters scattering = getScatteringValues(rayPos);
    vec3 sampleTransmittance = exp(-scattering.extinction * scaledStepSize);
    vec3 sunTransmittance = getSunTransmittanceLUT(transmittanceLUT, rayPos, dirToSun);
    if (rayIntersectSphere(rayPos, dirToSun, earthShadowRadius) > 0.0) {
      sunTransmittance = vec3(0.0);
    }
    vec3 inScattering = (scattering.rayleigh * rayleighPhaseValue + scattering.mie * miePhase) * sunTransmittance;
    vec3 scatteringIntegral = (inScattering - inScattering * sampleTransmittance) / max(vec3(0.0001), scattering.extinction);
    luminance += scatteringIntegral * transmittance;
    transmittance *= sampleTransmittance;
    rayPos += rayDir * stepSize;
  }
  ScatteringResult result;
  result.luminance = luminance;
  result.transmittance = transmittance;
  return result;
}

// ---- Tone mapping / sun disc (DrawAtmosphereCommon.hlsl + DrawSky.shader) ----
uniform float intensity;
uniform float contrast;
uniform float whitePoint;

vec3 reinhard_extended(vec3 v, float maxWhite) {
  vec3 numerator = v * (1.0 + (v / (maxWhite * maxWhite)));
  return numerator / (1.0 + v);
}
vec3 smoothMax(vec3 a, vec3 b, float k) {
  k = -abs(k);
  vec3 h = clamp((b - a + vec3(k)) / (2.0 * k), 0.0, 1.0);
  return a * h + b * (1.0 - h) - k * h * (1.0 - h);
}
vec3 toneMap(vec3 lum) {
  lum *= intensity;
  lum = mix(vec3(0.5), lum, vec3(contrast));
  lum = reinhard_extended(lum, whitePoint);
  lum = smoothMax(lum, vec3(-0.05), 0.05);
  return lum;
}
`;

export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export function createAtmosphereUniforms(): Record<string, THREE.IUniform> {
  return {
    atmosphereThickness: { value: ATMOSPHERE.atmosphereThickness },
    atmosphereRadius: { value: ATMOSPHERE.atmosphereRadius },
    planetRadius: { value: ATMOSPHERE.planetRadius },
    rayleighCoefficients: { value: ATMOSPHERE.rayleighCoefficients.clone() },
    rayleighDensityAvg: { value: ATMOSPHERE.rayleighDensityAvg },
    mieCoefficient: { value: ATMOSPHERE.mieCoefficient },
    mieDensityAvg: { value: ATMOSPHERE.mieDensityAvg },
    mieAbsorption: { value: ATMOSPHERE.mieAbsorption },
    ozonePeakDensityAltitude: { value: ATMOSPHERE.ozonePeakDensityAltitude },
    ozoneDensityFalloff: { value: ATMOSPHERE.ozoneDensityFalloff },
    ozoneAbsorption: { value: ATMOSPHERE.ozoneAbsorption.clone() },
    dirToSun: { value: new THREE.Vector3(0, 1, 0) },
    intensity: { value: ATMOSPHERE.intensity },
    contrast: { value: ATMOSPHERE.contrast },
    whitePoint: { value: ATMOSPHERE.whitePoint },
  };
}

const fullscreenGeometry = new THREE.BufferGeometry();
fullscreenGeometry.setAttribute(
  'position',
  new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
);

/** Render the transmittance LUT once into a small texture (port of TransmittanceDepthLUT). */
export function createTransmittanceLUT(renderer: THREE.WebGLRenderer): {
  texture: THREE.Texture;
  dispose: () => void;
} {
  const width = 128;
  const height = 64;
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      ${ATMOSPHERE_GLSL}
      layout(location = 0) out vec4 fragColor;
      uniform vec2 uSize;
      void main() {
        vec2 uv = gl_FragCoord.xy / (uSize - 1.0);
        float elevation = planetRadius + atmosphereThickness * uv.y;
        vec3 inPoint = vec3(0.0, elevation, 0.0);
        float y = -2.0 * uv.x + 1.0;
        float x = sin(acos(y));
        vec3 dir = vec3(x, y, 0.0);
        fragColor = vec4(getSunTransmittance(inPoint, dir), 1.0);
      }`,
    uniforms: { ...createAtmosphereUniforms(), uSize: { value: new THREE.Vector2(width, height) } },
  });

  const mesh = new THREE.Mesh(fullscreenGeometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.Camera();

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);

  material.dispose();

  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  };
}
