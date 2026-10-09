import * as THREE from 'three';
import { WORLD_RADIUS } from '../config';

/** Slightly above the surface so the point depth-sorts in front of the terrain. */
const LIGHT_HEIGHT = WORLD_RADIUS * 1.0015;

/**
 * Instanced night-side city lights (port of CityLights.cs / CityLightRenderer.cs +
 * CityLight.shader). Each light is a point sized in world units and coloured from the
 * upstream dim/bright ramp; it fades in around the terminator using its per-light
 * `randomT` and `intensity`.
 */
export class CityLights {
  readonly object: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;

  constructor(data: Float32Array) {
    // 5 floats per light: x, y, z, intensity, randomT.
    const count = Math.floor(data.length / 5);
    const positions = new Float32Array(count * 3);
    const intensity = new Float32Array(count);
    const randomT = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = data[i * 5] * LIGHT_HEIGHT;
      positions[i * 3 + 1] = data[i * 5 + 1] * LIGHT_HEIGHT;
      positions[i * 3 + 2] = data[i * 5 + 2] * LIGHT_HEIGHT;
      intensity[i] = data[i * 5 + 3];
      randomT[i] = data[i * 5 + 4];
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aIntensity', new THREE.BufferAttribute(intensity, 1));
    this.geometry.setAttribute('aRandomT', new THREE.BufferAttribute(randomT, 1));

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        // From Game.unity CityLights: sizes are *0.01 world units, warm colour ramp.
        uSizeMin: { value: 3.15 },
        uSizeMax: { value: 24.6 },
        uPixelsPerUnit: { value: 900 },
        uDimColour: { value: new THREE.Vector3(0.6431373, 0.41890523, 0) },
        uBrightColour: { value: new THREE.Vector3(1, 0.92440695, 0.6839622) },
        uBrightness: { value: 1.75 },
        uTurnOn: { value: 0.1 },
        uTurnOnVar: { value: 0.1 },
      },
      vertexShader: /* glsl */ `
        attribute float aIntensity;
        attribute float aRandomT;
        uniform vec3 uSunDir;
        uniform float uSizeMin, uSizeMax, uPixelsPerUnit, uTurnOn, uTurnOnVar, uBrightness;
        uniform vec3 uDimColour, uBrightColour;
        varying vec3 vColour;
        varying float vVisible;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vec3 dir = normalize(worldPos.xyz);
          vec4 mv = viewMatrix * worldPos;
          gl_Position = projectionMatrix * mv;

          // -1 = midnight, +1 = midday; lights fade in around the terminator.
          float sunDot = dot(dir, normalize(uSunDir));
          float lightAppear = uTurnOn + (aRandomT - 0.5) * uTurnOnVar;
          vVisible = clamp((lightAppear - sunDot) / 0.1, 0.0, 1.0);

          vColour = mix(uDimColour, uBrightColour * uBrightness, aIntensity);
          float size = mix(uSizeMin, uSizeMax, aIntensity) * 0.01;
          gl_PointSize = clamp(2.0 * size * uPixelsPerUnit / max(0.1, -mv.z), 0.0, 12.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColour;
        varying float vVisible;
        layout(location = 0) out vec4 fragColor;
        void main() {
          if (vVisible <= 0.001) discard;
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float edge = smoothstep(0.5, 0.34, d);
          fragColor = vec4(vColour * edge * vVisible, 1.0);
        }`,
    });

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
  }

  setSunDirection(dir: THREE.Vector3): void {
    this.material.uniforms.uSunDir.value.copy(dir).normalize();
  }

  /** Pixels per world unit at unit depth; lets point sizes be specified in world units. */
  setPixelsPerUnit(value: number): void {
    this.material.uniforms.uPixelsPerUnit.value = value;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
