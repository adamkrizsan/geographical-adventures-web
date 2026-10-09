import * as THREE from 'three';
import { ATMOSPHERE, ATMOSPHERE_GLSL, FULLSCREEN_VERTEX, createAtmosphereUniforms } from './atmosphere';

const RAYMARCH_STEPS = 128;
const LUT_WIDTH = 320;
const LUT_HEIGHT = 200;

/**
 * Physically-based atmosphere sky, ported from the upstream `AtmosphereEffect` /
 * `DrawSky` pass (Hillaire EGSR2020).
 *
 * Like the original, the expensive raymarch is rendered into a small texture and then
 * upscaled in a cheap fullscreen pass that adds the sun disc and tone mapping.
 */
export class Sky {
  readonly object: THREE.Mesh;

  private readonly geometry: THREE.BufferGeometry;
  private readonly raymarchMaterial: THREE.ShaderMaterial;
  private readonly drawMaterial: THREE.ShaderMaterial;
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly rtScene = new THREE.Scene();
  private readonly rtCamera = new THREE.Camera();

  constructor(transmittanceLUT: THREE.Texture) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );

    this.renderTarget = new THREE.WebGLRenderTarget(LUT_WIDTH, LUT_HEIGHT, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
    });

    // Pass 1: raymarch the atmosphere (small texture).
    this.raymarchMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: /* glsl */ `
        ${ATMOSPHERE_GLSL}
        layout(location = 0) out vec4 fragColor;
        uniform sampler2D uTransmittanceLUT;
        uniform vec3 uCamPos;
        uniform mat4 uInvProjection;
        uniform mat4 uCameraMatrixWorld;
        varying vec2 vUv;
        void main() {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec4 viewPos = uInvProjection * vec4(ndc, -1.0, 1.0);
          viewPos /= viewPos.w;
          vec3 viewDir = normalize((uCameraMatrixWorld * vec4(normalize(viewPos.xyz), 0.0)).xyz);

          vec2 hit = raySphere(vec3(0.0), atmosphereRadius, uCamPos, viewDir);
          vec3 col = vec3(0.0);
          if (hit.y > 0.0) {
            vec3 inPoint = uCamPos + viewDir * hit.x;
            ScatteringResult result = raymarch(inPoint, viewDir, hit.y, ${RAYMARCH_STEPS}, uTransmittanceLUT, planetRadius);
            col = result.luminance;
          }
          fragColor = vec4(col, 1.0);
        }`,
      uniforms: {
        ...createAtmosphereUniforms(),
        uTransmittanceLUT: { value: transmittanceLUT },
        uCamPos: { value: new THREE.Vector3() },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraMatrixWorld: { value: new THREE.Matrix4() },
      },
    });

    const raymarchQuad = new THREE.Mesh(this.geometry, this.raymarchMaterial);
    raymarchQuad.frustumCulled = false;
    this.rtScene.add(raymarchQuad);

    // Pass 2: upscale + sun disc + tone mapping (drawn into the main scene).
    this.drawMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: /* glsl */ `
        ${ATMOSPHERE_GLSL}
        layout(location = 0) out vec4 fragColor;
        uniform sampler2D uSky;
        uniform sampler2D uTransmittanceLUT;
        uniform vec3 uCamPos;
        uniform mat4 uInvProjection;
        uniform mat4 uCameraMatrixWorld;
        uniform float sunDiscSize;
        uniform float sunDiscBlurA;
        uniform float sunDiscBlurB;
        varying vec2 vUv;

        vec3 sunDiscWithBloom(vec3 rayDir, vec3 sunDir) {
          float sunSolidAngle = sunDiscSize * PI / 180.0;
          float minSunCosTheta = cos(sunSolidAngle);
          float cosTheta = dot(rayDir, sunDir);
          if (cosTheta >= minSunCosTheta) return vec3(1.0);
          float offset = minSunCosTheta - cosTheta;
          float gaussianBloom = exp(-offset * 1000.0 * sunDiscBlurA) * 0.5;
          float invBloom = 1.0 / (0.02 + offset * 100.0 * sunDiscBlurB) * 0.01;
          return vec3(gaussianBloom + invBloom);
        }

        void main() {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec4 viewPos = uInvProjection * vec4(ndc, -1.0, 1.0);
          viewPos /= viewPos.w;
          vec3 viewDir = normalize((uCameraMatrixWorld * vec4(normalize(viewPos.xyz), 0.0)).xyz);
          vec3 sunDir = normalize(dirToSun);

          vec3 col = texture2D(uSky, vUv).rgb;
          vec3 transmittance = getSunTransmittanceLUT(uTransmittanceLUT, uCamPos, viewDir);
          col += sunDiscWithBloom(viewDir, sunDir) * transmittance;
          col = toneMap(col);
          fragColor = vec4(col, 1.0);
        }`,
      uniforms: {
        ...createAtmosphereUniforms(),
        uSky: { value: this.renderTarget.texture },
        uTransmittanceLUT: { value: transmittanceLUT },
        uCamPos: { value: new THREE.Vector3() },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraMatrixWorld: { value: new THREE.Matrix4() },
        sunDiscSize: { value: ATMOSPHERE.sunDiscSize },
        sunDiscBlurA: { value: ATMOSPHERE.sunDiscBlurA },
        sunDiscBlurB: { value: ATMOSPHERE.sunDiscBlurB },
      },
    });

    this.object = new THREE.Mesh(this.geometry, this.drawMaterial);
    this.object.frustumCulled = false;
    this.object.renderOrder = -1000;
  }

  setSunDirection(dir: THREE.Vector3): void {
    this.raymarchMaterial.uniforms.dirToSun.value.copy(dir).normalize();
    this.drawMaterial.uniforms.dirToSun.value.copy(dir).normalize();
  }

  /** Update per-frame camera matrices (call before render). */
  update(camera: THREE.PerspectiveCamera): void {
    for (const material of [this.raymarchMaterial, this.drawMaterial]) {
      material.uniforms.uCamPos.value.copy(camera.position);
      material.uniforms.uCameraMatrixWorld.value.copy(camera.matrixWorld);
      material.uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
    }
  }

  /** Render the atmosphere raymarch into the small LUT (call before the main render). */
  renderToLUT(renderer: THREE.WebGLRenderer): void {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTarget);
    renderer.render(this.rtScene, this.rtCamera);
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.geometry.dispose();
    this.raymarchMaterial.dispose();
    this.drawMaterial.dispose();
    this.renderTarget.dispose();
  }
}
