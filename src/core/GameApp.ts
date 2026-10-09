import * as THREE from 'three';
import { CAMERA } from '../config';
import { Input } from './Input';
import { Globe } from '../world/Globe';
import { Player } from '../entity/Player';
import { Hud } from '../ui/Hud';
import { QuestUI } from '../ui/QuestUI';
import { Gauges } from '../ui/Gauges';
import { QuestSystem } from '../game/QuestSystem';
import { loadQuestData, locationCountryName } from '../game/questData';
import { compassBearing } from '../math/geo';
import { loadModels } from '../world/models';
import { Starfield } from '../world/Starfield';
import { Sky } from '../world/Sky';
import { createTransmittanceLUT } from '../world/atmosphere';

/**
 * Upstream `QualitySettings.shadowDistance` (Ultra) — the globe radius. Shadows are only
 * rendered within this distance of the camera, and the shadow camera follows the player.
 */
const SHADOW_DISTANCE = 150;
/** Distance from the player to place the directional light (sets the shadow camera depth). */
const SUN_SHADOW_DISTANCE = 500;

/**
 * Owns the renderer, scene, camera and the fixed set of runtime systems, and drives the
 * frame loop. Later phases register additional systems here (ocean, quests, map view).
 */
export class GameApp {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input = new Input();

  private globe!: Globe;
  private player!: Player;
  private hud!: Hud;
  private questUI!: QuestUI;
  private gauges!: Gauges;
  private quests!: QuestSystem;
  private sky!: Sky;
  private stars!: Starfield;
  private readonly sunDirection = new THREE.Vector3(0, 1, 0);
  private sunAnim: { from: THREE.Vector3; axis: THREE.Vector3; angle: number; t: number; duration: number } | null = null;
  private sunLight!: THREE.DirectionalLight;
  private raf = 0;
  private lastFrameTime = 0;
  private elapsed = 0;
  private readonly debugGlobe = new URLSearchParams(window.location.search).has('globe');
  /** Debug: skip feeding the shadow map to the globe shaders (`?noshadow`). */
  private readonly noShadow = new URLSearchParams(window.location.search).has('noshadow');
  /** Camera view mode (GameCamera.ViewMode); switched with 1 / 2 / 3 (or `?view=`). */
  private viewMode: 'forward' | 'behind' | 'topdown' = (() => {
    const v = new URLSearchParams(window.location.search).get('view');
    return v === 'behind' || v === 'topdown' ? v : 'forward';
  })();
  /** Debug: start holding a package (`?carry`) and auto-drop it (`?drop`). */
  private readonly carryAtStart = new URLSearchParams(window.location.search).has('carry');
  private readonly autoDrop = new URLSearchParams(window.location.search).has('drop');
  private autoDropTimer = 2.5;
  /** Direction hinting + distances (off by default; toggled with N). */
  private navAids = false;

  private readonly camTarget = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly drawSize = new THREE.Vector2();

  private readonly onResize = (): void => {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    // The upstream project is authored in a gamma (non-linear) space; keep values
    // pass-through so the ported shaders match the original look.
    THREE.ColorManagement.enabled = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fovSlow,
      canvas.clientWidth / canvas.clientHeight,
      CAMERA.near,
      CAMERA.far,
    );

    this.scene.background = new THREE.Color(0x03050a);

    const sun = new THREE.DirectionalLight(0xfff3e0, 3.1);
    // The shadow camera follows the player (see updateSunLight) with the upstream shadow
    // distance, instead of covering the whole globe at low resolution.
    sun.position.set(300, 180, 220);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -SHADOW_DISTANCE;
    sun.shadow.camera.right = SHADOW_DISTANCE;
    sun.shadow.camera.top = SHADOW_DISTANCE;
    sun.shadow.camera.bottom = -SHADOW_DISTANCE;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = SUN_SHADOW_DISTANCE + SHADOW_DISTANCE + 100;
    sun.shadow.camera.updateProjectionMatrix();
    this.sunLight = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.scene.add(new THREE.AmbientLight(0x2a3550, 1.4));
    this.scene.add(new THREE.HemisphereLight(0x93b9ff, 0x101820, 0.55));

    window.addEventListener('resize', this.onResize);
  }

  async init(): Promise<void> {
    const [globe, models, questData] = await Promise.all([
      Globe.create(),
      loadModels(),
      loadQuestData(),
    ]);

    this.globe = globe;
    this.scene.add(globe.group);

    this.player = new Player(globe.radius, models.plane);
    this.player.topDownMode = this.viewMode === 'topdown';
    this.scene.add(this.player.object);
    this.scene.add(this.player.trails.object);

    this.hud = new Hud();
    this.questUI = new QuestUI();
    this.questUI.setNavAids(this.navAids);
    this.gauges = new Gauges();

    const starData = await fetch('assets/data/stars.bin')
      .then((r) => r.arrayBuffer())
      .then((b) => new Float32Array(b));
    this.stars = new Starfield(starData);
    this.scene.add(this.stars.object);

    const lut = createTransmittanceLUT(this.renderer);
    this.sky = new Sky(lut.texture);
    this.scene.add(this.sky.object);

    const seedParam = new URLSearchParams(window.location.search).get('seed');
    const seed = seedParam !== null && seedParam !== '' ? Number(seedParam) : null;
    this.quests = new QuestSystem(questData, globe, this.player, this.scene, this.questUI, models, seed);
    this.quests.start();
    if (this.carryAtStart) this.quests.debugPickupFirst();

    // Sun setup: overhead at the player (default), opposite (?night), or at a given
    // altitude (?sunalt=deg) for testing twilight colours.
    const params = new URLSearchParams(window.location.search);
    let sunDir = this.player.positionUnit.clone();
    if (params.has('night')) sunDir.negate();
    if (params.has('sunalt')) {
      const altitude = THREE.MathUtils.degToRad(Number(params.get('sunalt')));
      const up = this.player.positionUnit;
      const forward = this.player.forwardUnit;
      sunDir = up
        .clone()
        .multiplyScalar(Math.sin(altitude))
        .addScaledVector(forward, Math.cos(altitude))
        .normalize();
    }
    this.setSunDirection(sunDir);

    this.updateCamera(0);
    this.onResize();
  }

  start(): void {
    this.lastFrameTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.renderer.dispose();
  }

  private readonly tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;
    this.elapsed += dt;

    this.player.update(dt, this.input.flight);
    if (this.autoDrop && this.elapsed > 2) {
      this.autoDropTimer -= dt;
      if (this.autoDropTimer <= 0) {
        this.autoDropTimer = 1.8;
        this.quests.debugSpawnPackage();
      }
    }
    this.updateSunLight();
    this.globe.update(this.elapsed);
    if (this.input.wasPressed('Space')) this.quests.tryDropPackage();
    // Make Daytime / Make Nighttime (Backspace / Enter) — animated, like the original
    // solar-system fast-forward (instead of snapping the sun).
    if (this.input.wasPressed('Backspace')) this.beginSunTransition(false);
    if (this.input.wasPressed('Enter')) this.beginSunTransition(true);
    this.updateSunTransition(dt);
    // Camera views (upstream keys 1 / 2 / 3).
    if (this.input.wasPressed('Digit1')) this.setViewMode('forward');
    if (this.input.wasPressed('Digit2')) this.setViewMode('behind');
    if (this.input.wasPressed('Digit3')) this.setViewMode('topdown');
    // H toggles the oversized control hints.
    if (this.input.wasPressed('KeyH')) this.hud.toggleControls();
    // N toggles navigation aids (direction hint + distances; off by default).
    if (this.input.wasPressed('KeyN')) {
      this.navAids = !this.navAids;
      this.questUI.setNavAids(this.navAids);
    }
    this.sky.update(this.camera);
    this.stars.setNight(
      1 - THREE.MathUtils.smoothstep(this.player.positionUnit.dot(this.sunDirection), -0.15, 0.1),
    );
    this.quests.update(dt);
    this.updateDestination();
    this.updateCamera(dt);
    this.player.updateTrails(this.camera.position, dt);
    // City-light point sizes are in world units, so they need the current pixels-per-unit.
    const drawSize = this.renderer.getDrawingBufferSize(this.drawSize);
    this.globe.cityLights?.setPixelsPerUnit(this.camera.projectionMatrix.elements[5] * drawSize.y * 0.5);
    this.hud.update(this.player, dt);
    this.gauges.update(this.player, dt);
    this.questUI.update(dt);

    this.sky.renderToLUT(this.renderer);
    if (!this.noShadow) this.globe.updateShadow(this.sunLight);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  };  /** Begin a smooth day <-> night transition: the sun sweeps over ~1.8 s. */
  private beginSunTransition(night: boolean): void {
    const from = this.sunDirection.clone();
    const target = this.player.positionUnit.clone();
    if (night) target.negate();
    const axis = new THREE.Vector3().crossVectors(from, target);
    if (axis.lengthSq() < 1e-6) {
      // Exactly opposite: sweep around the horizon instead of through the planet.
      axis.crossVectors(this.player.positionUnit, this.player.forwardUnit);
      if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    }
    axis.normalize();
    this.sunAnim = { from, axis, angle: from.angleTo(target), t: 0, duration: 1.8 };
  }

  private updateSunTransition(dt: number): void {
    const anim = this.sunAnim;
    if (!anim) return;
    anim.t = Math.min(1, anim.t + dt / anim.duration);
    const eased = anim.t * anim.t * (3 - 2 * anim.t);
    this.setSunDirection(anim.from.clone().applyAxisAngle(anim.axis, anim.angle * eased));
    if (anim.t >= 1) this.sunAnim = null;
  }

  private setSunDirection(dir: THREE.Vector3): void {
    this.sunDirection.copy(dir).normalize();
    this.globe.setSunDirection(dir);
    this.sky.setSunDirection(dir);
    this.updateSunLight();
  }

  /**
   * Position the directional light (and therefore its shadow camera) relative to the player
   * so shadows stay high-resolution near the camera, matching the upstream `shadowDistance`.
   */
  private updateSunLight(): void {
    const p = this.player.object.position;
    this.sunLight.target.position.copy(p);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.position.copy(p).addScaledVector(this.sunDirection, SUN_SHADOW_DISTANCE);
    this.sunLight.updateMatrixWorld();
    // Refresh the shadow matrix now so the globe shaders read the same matrix this frame.
    this.sunLight.shadow.updateMatrices(this.sunLight);
  }

  private setViewMode(mode: 'forward' | 'behind' | 'topdown'): void {
    this.viewMode = mode;
    this.player.topDownMode = mode === 'topdown';
  }

  /**
   * Update the on-screen delivery-destination banner: while carrying a package, show the
   * target city/country and an arrow pointing toward it relative to the current camera.
   */
  private updateDestination(): void {
    const delivery = this.quests.activeDelivery;
    if (!delivery) {
      this.questUI.setDelivery(null, 0);
      return;
    }
    const bearing = compassBearing(this.player.positionUnit, delivery.deliverPoint);
    const behind = this.viewMode === 'behind' ? 180 : 0;
    this.questUI.setDelivery(
      {
        city: delivery.deliver.city.displayName,
        country: locationCountryName(delivery.deliver),
        distanceKm: delivery.distanceKm,
      },
      bearing - this.player.heading + behind,
    );
  }

  private updateCamera(dt: number): void {
    if (this.debugGlobe) {
      this.camera.position.set(60, 150, 360);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
      this.camera.fov = 45;
      this.camera.updateProjectionMatrix();
      return;
    }
    const position = this.player.getPosition(this.camPos);
    const up = this.player.positionUnit;
    const forward = this.player.forwardUnit;

    if (this.viewMode === 'topdown') {
      // GameCamera.UpdateTopDownView: sit `distanceAbove` above the plane, look at it using
      // the plane's forward as the up hint, then rotate around gravity to follow the heading.
      this.camera.position.copy(position).addScaledVector(up, CAMERA.topDown.distanceAbove);
      this.camera.up.copy(forward);
      this.camera.lookAt(position);
      // The port rotates the plane by -totalTurnAngle (three's handedness), so the camera
      // must rotate by +totalTurnAngle to keep a stable orientation (matching upstream's
      // +turn / -turn pair). Using -totalTurnAngle here spun the view at double speed.
      const angle = THREE.MathUtils.degToRad(this.player.totalTurnAngle + CAMERA.topDown.startAngle);
      this.camera.rotateOnWorldAxis(up, angle);
    } else {
      // GameCamera.UpdateAlternateView for the looking-ahead / looking-behind views.
      const view = this.viewMode === 'behind' ? CAMERA.lookingBehind : CAMERA.lookingAhead;
      this.camTarget
        .copy(position)
        .addScaledVector(forward, view.offset.z)
        .addScaledVector(up, view.offset.y);
      this.camera.position.copy(this.camTarget);
      this.camera.up.copy(up);

      this.camLook
        .copy(position)
        .addScaledVector(up, view.look.y)
        .addScaledVector(forward, view.look.z);
      this.camera.lookAt(this.camLook);
    }

    // FOV widens with speed and while boosting (GameCamera.CalculateFOV + fovSmoothTime).
    const targetFov = this.player.isBoosting
      ? CAMERA.fovBoost
      : THREE.MathUtils.lerp(CAMERA.fovSlow, CAMERA.fovFast, this.player.speedT);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 2 / CAMERA.fovSmoothTime, dt);
    this.camera.updateProjectionMatrix();
  }
}
