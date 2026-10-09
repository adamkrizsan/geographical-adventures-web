import * as THREE from 'three';

/**
 * Starfield built from the real HYG catalogue (port of StarRenderer.cs).
 * Each star is a point with size/brightness from its magnitude and colour from its
 * colour index.
 */
export class Starfield {
  readonly object: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(data: Float32Array, radius = 5000) {
    const count = data.length / 5;
    const positions = new Float32Array(count * 3);
    const mags = new Float32Array(count);
    const colors = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Star directions are in the same convention as the (mirrored) world.
      positions[i * 3] = -data[i * 5] * radius;
      positions[i * 3 + 1] = data[i * 5 + 1] * radius;
      positions[i * 3 + 2] = data[i * 5 + 2] * radius;
      mags[i] = data[i * 5 + 3];
      colors[i] = data[i * 5 + 4];
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
    this.geometry.setAttribute('aCi', new THREE.BufferAttribute(colors, 1));

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      // Additive: stars glow against the dark sky. (Normal blending squared the alpha,
      // which made the faint majority of stars invisible.)
      blending: THREE.AdditiveBlending,
      uniforms: {
        uNight: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aMag;
        attribute float aCi;
        varying vec3 vColor;
        varying float vBright;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Colour index -> approximate B-V tint (hot blue .. cool red).
          vec3 tint = vec3(
            clamp(1.0 - aCi * 0.16, 0.62, 1.0),
            1.0,
            clamp(1.0 + aCi * 0.22, 0.7, 1.35)
          );
          vColor = tint;
          // Magnitude -1.5 (brightest) .. 6.5 (faintest) -> brightness/size.
          float t = clamp((aMag + 1.5) / 8.0, 0.0, 1.0);
          vBright = mix(1.3, 0.5, t);
          gl_PointSize = mix(5.0, 2.4, t);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vBright;
        uniform float uNight;
        layout(location = 0) out vec4 fragColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float glow = smoothstep(0.5, 0.0, d);
          // Additive blending premultiplies by alpha, so keep alpha at 1.
          fragColor = vec4(vColor * glow * vBright * uNight, 1.0);
        }`,
    });

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -1;
  }

  setNight(f: number): void {
    this.material.uniforms.uNight.value = f;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
