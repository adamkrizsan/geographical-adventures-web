import * as THREE from 'three';
import { SUN_DIRECTION } from '../config';
import { TERRAIN_VERTEX, TERRAIN_FRAGMENT, OCEAN_VERTEX, OCEAN_FRAGMENT } from './shaders';
import { textureSize } from '../io/textures';

export interface TerrainTextures {
  colourWest: THREE.Texture;
  colourEast: THREE.Texture;
  normalWest: THREE.Texture;
  normalEast: THREE.Texture;
  lightMap: THREE.Texture;
  lakes: THREE.Texture;
  waveNormalA: THREE.Texture;
}

export interface OceanTextures {
  oceanCol: THREE.Texture;
  noise: THREE.Texture;
  waveNormalA: THREE.Texture;
  waveNormalB: THREE.Texture;
  shoreDst: THREE.Texture;
}

export function sunDirection(): THREE.Vector3 {
  return new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize();
}

/**
 * Port of Assets/Scripts/Shaders/Game/Terrain.shader.
 * Property values come from Assets/Graphics/Materials/Game/Terrain.mat.
 */
export function createTerrainMaterial(tex: TerrainTextures): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    uniforms: {
      uColWest: { value: tex.colourWest },
      uColEast: { value: tex.colourEast },
      uNormalWest: { value: tex.normalWest },
      uNormalEast: { value: tex.normalEast },
      uLightMap: { value: tex.lightMap },
      uLakeMask: { value: tex.lakes },
      uWaveNormalA: { value: tex.waveNormalA },
      uColTexSize: { value: textureSize(tex.colourWest) },
      uSunDir: { value: sunDirection() },
      uAmbientNight: { value: new THREE.Vector3(0.39607844, 0.36862746, 0.58431375) },
      uCityLightAmbient: { value: new THREE.Vector3(0.4433962, 0.312395, 0.19032574) },
      uFresnelCol: { value: new THREE.Vector3(0.14901961, 0.039215688, 0.078431375) },
      uShadowEdgeCol: { value: new THREE.Vector3(0.254717, 0.03245007, 0.0084104715) },
      uShadowInnerCol: { value: new THREE.Vector3(0, 0, 0) },
      uShadowStrength: { value: 0.7 },
      uContrast: { value: 1.1 },
      uBrightnessAdd: { value: 0.05 },
      uBrightnessMul: { value: 1.5 },
      uSpecular: { value: 0.07 },
      uWaveNormalScale: { value: 0.74 },
      uWaveStrength: { value: 0.088 },
      uShadowMap: { value: null as THREE.Texture | null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowEnabled: { value: 0 },
      // Upstream Light: shadows are soft, m_Strength = 0.8, m_NormalBias = 0.2.
      uShadowIntensity: { value: 0.8 },
      uShadowNormalBias: { value: 0.2 },
    },
  });
}

/**
 * Port of Assets/Scripts/Shaders/Game/Ocean.shader.
 * Property values come from Assets/Graphics/Materials/Game/Ocean.mat.
 */
export function createOceanMaterial(tex: OceanTextures): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: OCEAN_VERTEX,
    fragmentShader: OCEAN_FRAGMENT,
    // Offset 1,1 from the upstream shader: in a z-fight the ocean should lose to terrain.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    uniforms: {
      uOceanCol: { value: tex.oceanCol },
      uNoise: { value: tex.noise },
      uWaveNormalA: { value: tex.waveNormalA },
      uWaveNormalB: { value: tex.waveNormalB },
      uFoamDistanceMap: { value: tex.shoreDst },
      uOceanColTexSize: { value: textureSize(tex.oceanCol) },
      uSunDir: { value: sunDirection() },
      uAmbient: { value: new THREE.Vector3(0, 0.29825285, 0.58431375) },
      uFresnelCol: { value: new THREE.Vector3(0, 0.13736644, 0.4716981) },
      uFoamColour: { value: new THREE.Vector3(1, 1, 1) },
      uTime: { value: 0 },
      uSpecularSmoothness: { value: 0.1 },
      uWaveNormalScale: { value: 0.5 },
      uWaveStrength: { value: 0.8 },
      uWaveSpeed: { value: 1 },
      uRefraction: { value: 4 },
      uShadowStrength: { value: 0.85 },
      uFresnelWeight: { value: 0.73 },
      uFresnelPower: { value: 10 },
      uFoamDst: { value: 0.8 },
      uFoamSpeed: { value: 0.75 },
      uFoamFrequency: { value: 15 },
      uFoamWidth: { value: -0.75 },
      uFoamEdgeBlend: { value: 8.7 },
      uShoreFoamDst: { value: 0.045 },
      uFoamNoiseSpeed: { value: 1.2 },
      uFoamNoiseStrength: { value: 32.8 },
      uFoamNoiseScale: { value: 2 },
      uFoamMaskScale: { value: 1 },
      uFoamMaskBlend: { value: 10 },
      uShadowMap: { value: null as THREE.Texture | null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowEnabled: { value: 0 },
      // Upstream Light: shadows are soft, m_Strength = 0.8, m_NormalBias = 0.2.
      uShadowIntensity: { value: 0.8 },
      uShadowNormalBias: { value: 0.2 },
    },
  });
}
