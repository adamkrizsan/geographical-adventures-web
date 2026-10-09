import * as THREE from 'three';
import { EARTH_RADIUS_KM, FLIGHT, PLAYER_START, WORLD_RADIUS } from '../config';
import { angleBetween, latLonToVector3, vector3ToLatLon, type LatLon } from '../math/geo';
import { smoothDamp, smoothDampAngle, type FloatRef } from '../math/smoothDamp';
import { cloneModel, PLANE_YELLOW } from '../world/models';
import { WingTrails } from './WingTrails';
import type { FlightInput } from '../core/Input';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEG2RAD = Math.PI / 180;

function numberParam(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Player flight controller — a direct port of Player.cs.
 *
 * The plane travels on the sphere: position is kept as a world vector, the heading as a
 * unit tangent, and elevation as a scalar above `worldRadius`. Pitch drives vertical
 * velocity, turn rotates around the local "gravity up".
 */
export class Player {
  readonly object = new THREE.Group();
  readonly model = new THREE.Group();
  readonly trails = new WingTrails();

  position = new THREE.Vector3();
  forward = new THREE.Vector3();

  currentElevation = 0;
  currentSpeed = 0;
  baseTargetSpeed = 0;
  totalTurnAngle = 0;
  currentPitchAngle = 0;
  currentRollAngle = 0;
  distanceTravelledKm = 0;

  boostTimeRemaining: number = FLIGHT.boostTimeAtStart;
  boostTimeToAdd = 0;
  /** Set by the camera: top-down mode uses the faster turn speed (upstream Player.cs). */
  topDownMode = false;

  private turnInput = 0;
  private pitchInput = 0;
  private boosting = false;
  private smoothedTurnSpeed = 0;
  private readonly turnSmoothV: FloatRef = { value: 0 };
  private readonly pitchSmoothV: FloatRef = { value: 0 };
  private readonly rollSmoothV: FloatRef = { value: 0 };

  private readonly quaternion = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly prevPos = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly north = new THREE.Vector3();
  private readonly east = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();

  constructor(
    private readonly radius = WORLD_RADIUS,
    private readonly planeModel: THREE.Group | null = null,
  ) {
    this.buildModel();
    this.object.add(this.model);
    this.object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    this.setStartPos();
  }

  // ---- Ported flight model -------------------------------------------------

  update(dt: number, input: FlightInput): void {
    // UpdateMovementInput (Player.cs)
    if (this.debugTurn !== null && this.debugTurnRemaining > 0) {
      this.turnInput = this.debugTurn;
      this.debugTurnRemaining -= dt;
    } else {
      this.turnInput = input.turn;
    }
    this.pitchInput = input.pitch;
    this.baseTargetSpeed += ((FLIGHT.maxSpeed - FLIGHT.minSpeed) / FLIGHT.accelerateDuration) * input.accelerateDir * dt;
    this.baseTargetSpeed = THREE.MathUtils.clamp(this.baseTargetSpeed, FLIGHT.minSpeed, FLIGHT.maxSpeed);
    this.boosting = input.boost && this.boostTimeRemaining > 0;

    this.handleMovement(dt);
    this.updateBoostTimer(dt);
    this.updateGraphics();
    this.updatePropeller(dt);
  }

  /** Spin our custom propeller, scaling with speed (slow idle → fast blur → boost). */
  private updatePropeller(dt: number): void {
    if (!this.propeller) return;
    const rate = (4 + this.speedT * 60) * (this.boosting ? 1.8 : 1);
    this.propeller.rotation.z -= rate * dt;
    if (this.propellerBlur) {
      // Fade the blades into a blur disc as speed increases.
      this.propellerBlur.opacity = THREE.MathUtils.lerp(0.05, 0.4, this.speedT) * (this.boosting ? 1.3 : 1);
    }
  }

  private handleMovement(dt: number): void {
    // Turn
    const turnSpeed = this.topDownMode ? FLIGHT.turnSpeedInTopDownView : FLIGHT.turnSpeedInBehindView;
    this.smoothedTurnSpeed = smoothDamp(this.smoothedTurnSpeed, this.turnInput * turnSpeed, this.turnSmoothV, FLIGHT.turnSmoothTime, dt);
    const turnAmount = this.smoothedTurnSpeed * dt;
    this.totalTurnAngle += turnAmount;

    // Speed
    const targetSpeed = this.boosting ? FLIGHT.boostSpeed : this.baseTargetSpeed;
    this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, targetSpeed, 1 - Math.pow(FLIGHT.speedSmoothing, dt));

    // Forward / vertical components from pitch
    const forwardSpeed = Math.cos(Math.abs(this.currentPitchAngle) * DEG2RAD) * this.currentSpeed;
    const verticalVelocity = -Math.sin(this.currentPitchAngle * DEG2RAD) * this.currentSpeed;

    this.currentElevation = THREE.MathUtils.clamp(
      this.currentElevation + verticalVelocity * dt,
      FLIGHT.minElevation,
      FLIGHT.maxElevation,
    );

    this.updatePosition(forwardSpeed, dt);
    this.updateRotation(turnAmount);

    // Pitch and roll
    let targetPitch = this.pitchInput * FLIGHT.maxPitchAngle;
    const dstToPitchLimit = targetPitch > 0 ? this.currentElevation - FLIGHT.minElevation : FLIGHT.maxElevation - this.currentElevation;
    targetPitch *= THREE.MathUtils.clamp(dstToPitchLimit / FLIGHT.pitchLimitSmoothDst, 0, 1);
    this.currentPitchAngle = smoothDampAngle(this.currentPitchAngle, targetPitch, this.pitchSmoothV, FLIGHT.smoothPitchTime, dt);

    const targetRoll = this.turnInput * FLIGHT.rollAngle;
    this.currentRollAngle = smoothDampAngle(this.currentRollAngle, targetRoll, this.rollSmoothV, FLIGHT.smoothRollTime, dt);
  }

  private updatePosition(forwardSpeed: number, dt: number): void {
    this.prevPos.copy(this.position);
    this.position.addScaledVector(this.forward, forwardSpeed * dt);
    this.position.normalize().multiplyScalar(this.radius + this.currentElevation);
    this.distanceTravelledKm += angleBetween(this.prevPos.normalize(), this.position.clone().normalize()) * EARTH_RADIUS_KM;
  }

  private updateRotation(turnAmount: number): void {
    const gravityUp = this.scratch.copy(this.position).normalize();
    // Negated: three.js is right-handed, so a positive rotation about "up" turns the
    // opposite way to Unity's left-handed RotateAround.
    this.quaternion.setFromAxisAngle(gravityUp, -turnAmount * DEG2RAD);
    this.forward.applyQuaternion(this.quaternion).normalize();
    // Keep the heading tangent to the sphere.
    this.forward.addScaledVector(gravityUp, -this.forward.dot(gravityUp)).normalize();
  }

  private updateBoostTimer(dt: number): void {
    if (this.boosting) this.boostTimeRemaining = Math.max(0, this.boostTimeRemaining - dt);
    if (this.boostTimeToAdd > 0) {
      const boostAddSpeed = 4;
      const add = Math.min(dt * boostAddSpeed, this.boostTimeToAdd);
      this.boostTimeRemaining = Math.min(this.boostTimeRemaining + add, FLIGHT.maxBoostTime);
      this.boostTimeToAdd -= add;
    }
  }

  private updateGraphics(): void {
    this.object.position.copy(this.position);
    const zAxis = this.forward;
    const yAxis = this.scratch.copy(this.position).normalize();
    const xAxis = this.axis.crossVectors(yAxis, zAxis).normalize();
    this.matrix.makeBasis(xAxis, yAxis, zAxis);
    this.object.quaternion.setFromRotationMatrix(this.matrix);

    // Roll sign is flipped for three.js's right-handed frame (Unity's -35 banks right).
    const roll = this.debugRoll !== null ? this.debugRoll : -this.currentRollAngle;
    this.model.rotation.set(this.currentPitchAngle * DEG2RAD, 0, roll * DEG2RAD);
  }

  /** Advance the wingtip contrails (called after the camera has been updated). */
  updateTrails(cameraPos: THREE.Vector3, dt: number): void {
    this.object.updateMatrixWorld(true);
    this.wingtipLeftWorld.copy(this.wingtipLeft);
    this.wingtipRightWorld.copy(this.wingtipRight);
    this.model.localToWorld(this.wingtipLeftWorld);
    this.model.localToWorld(this.wingtipRightWorld);
    this.trails.update(dt, this.wingtipLeftWorld, this.wingtipRightWorld, cameraPos, this.speedT);
  }

  // ---- Queries -------------------------------------------------------------

  get positionUnit(): THREE.Vector3 {
    return this.scratchPosition.copy(this.position).normalize();
  }

  get forwardUnit(): THREE.Vector3 {
    return this.forward;
  }

  get elevation(): number {
    return this.currentElevation;
  }

  get speed(): number {
    return this.currentSpeed;
  }

  get isBoosting(): boolean {
    return this.boosting;
  }

  get boostCharging(): boolean {
    return this.boostTimeToAdd > 0;
  }

  get speedT(): number {
    return THREE.MathUtils.clamp((this.currentSpeed - FLIGHT.minSpeed) / (FLIGHT.maxSpeed - FLIGHT.minSpeed), 0, 1);
  }

  get boostRemainingT(): number {
    return THREE.MathUtils.clamp(this.boostTimeRemaining / FLIGHT.maxBoostTime, 0, 1);
  }

  get latLon(): LatLon {
    return vector3ToLatLon(this.position);
  }

  /** Compass heading in degrees, 0 = north, clockwise. */
  get heading(): number {
    const north = this.north.copy(WORLD_UP).addScaledVector(this.positionUnit, -WORLD_UP.dot(this.positionUnit)).normalize();
    // Right-handed world: east = north × up (mirror of Unity's up × north).
    const east = this.east.crossVectors(north, this.positionUnit).normalize();
    const deg = THREE.MathUtils.radToDeg(Math.atan2(this.forward.dot(east), this.forward.dot(north)));
    return (deg + 360) % 360;
  }

  getPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.position);
  }

  addBoost(time: number): void {
    this.boostTimeToAdd += time;
  }

  // ---- Setup ---------------------------------------------------------------

  setStartPos(): void {
    const params = new URLSearchParams(window.location.search);
    const startLat = numberParam(params.get('lat'), PLAYER_START.latitude);
    const startLon = numberParam(params.get('lon'), PLAYER_START.longitude);
    const startHeading = numberParam(params.get('heading'), PLAYER_START.angle);
    const startElevationT = numberParam(params.get('alt'), PLAYER_START.elevationT);
    this.debugRoll = params.has('roll') ? Number(params.get('roll')) : null;
    this.debugTurn = params.has('turn') ? Number(params.get('turn')) : null;
    this.debugTurnRemaining = params.has('turntime') ? Number(params.get('turntime')) : 2;

    this.currentElevation = THREE.MathUtils.lerp(FLIGHT.minElevation, FLIGHT.maxElevation, startElevationT);
    this.baseTargetSpeed = THREE.MathUtils.lerp(FLIGHT.minSpeed, FLIGHT.maxSpeed, 0.35);
    this.currentSpeed = this.baseTargetSpeed;
    this.boostTimeRemaining = FLIGHT.boostTimeAtStart;
    this.totalTurnAngle = 0;
    this.currentPitchAngle = 0;
    this.currentRollAngle = 0;
    this.smoothedTurnSpeed = 0;

    latLonToVector3(startLat, startLon, 1, this.position).multiplyScalar(this.radius + this.currentElevation);

    const up = this.positionUnit;
    const north = this.north.copy(WORLD_UP).addScaledVector(up, -WORLD_UP.dot(up)).normalize();
    const east = this.east.crossVectors(north, up).normalize();
    const heading = startHeading * DEG2RAD;
    this.forward.copy(north).multiplyScalar(Math.cos(heading)).addScaledVector(east, Math.sin(heading)).normalize();

    this.updateGraphics();
  }

  private readonly scratchPosition = new THREE.Vector3();
  private readonly wingtipLeft = new THREE.Vector3();
  private readonly wingtipRight = new THREE.Vector3();
  private readonly wingtipLeftWorld = new THREE.Vector3();
  private readonly wingtipRightWorld = new THREE.Vector3();
  private propeller: THREE.Group | null = null;
  private propellerBlur: THREE.MeshBasicMaterial | null = null;
  private debugRoll: number | null = null;
  private debugTurn: number | null = null;
  private debugTurnRemaining = 0;

  private buildModel(): void {
    // Real Plane.fbx model when available, else a stylised placeholder.
    if (this.planeModel) {
      this.model.add(cloneModel(this.planeModel));
      this.computeWingtips();
      this.addWingtipLights();
      this.buildPropeller();
      return;
    }

    const body = new THREE.MeshStandardMaterial({ color: PLANE_YELLOW, roughness: 0.55, metalness: 0.12 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xd9a316, roughness: 0.7, metalness: 0.05 });

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.2, 14), body);
    nose.geometry.rotateX(Math.PI / 2);
    nose.position.z = 1.0;
    this.model.add(nose);

    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 3.4, 12), body);
    fuselage.geometry.rotateX(Math.PI / 2);
    fuselage.position.z = -1.6;
    this.model.add(fuselage);

    const wings = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.18, 1.7), accent);
    wings.position.z = -0.6;
    this.model.add(wings);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.9), accent);
    tail.position.z = -3.2;
    this.model.add(tail);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.9), accent);
    fin.position.set(0, 0.6, -3.2);
    this.model.add(fin);

    this.model.scale.setScalar(0.42);
    this.computeWingtips();
  }

  /**
   * Wingtip local positions: the model's max/min-X vertices (the actual wing ends), so the
   * lights and contrails sit right on the wings.
   */
  private computeWingtips(): void {
    this.model.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    const local = new THREE.Matrix4();
    const point = new THREE.Vector3();
    let maxX = -Infinity;
    let minX = Infinity;
    this.model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.attributes.position;
      if (!positions) return;
      local.multiplyMatrices(inverse, mesh.matrixWorld);
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(local);
        if (point.x > maxX) {
          maxX = point.x;
          this.wingtipLeft.copy(point);
        }
        if (point.x < minX) {
          minX = point.x;
          this.wingtipRight.copy(point);
        }
      }
    });
  }

  /** Add the port/starboard navigation lights (upstream `Red light` / `Green light` + glow). */
  private addWingtipLights(): void {
    const add = (position: THREE.Vector3, bulbColor: number, glowColor: number): void => {
      const light = new THREE.Group();
      light.position.copy(position);
      light.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(0.045, 8, 8),
          new THREE.MeshBasicMaterial({ color: bulbColor }),
        ),
      );
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: glowColor,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0.85,
        }),
      );
      glow.scale.setScalar(0.55);
      light.add(glow);
      this.model.add(light);
    };
    add(this.wingtipLeft, 0xff2a1a, 0xff4030);
    add(this.wingtipRight, 0x2aff55, 0x40ff66);
  }

  /**
   * Replace the FBX propeller with our own (its nodes have awkward pivots/scales): a hub,
   * blades and a translucent blur disc, placed at the original prop's location and spun
   * about the plane's forward (local Z).
   */
  private buildPropeller(): void {
    this.model.updateMatrixWorld(true);

    const propMeshes: THREE.Mesh[] = [];
    this.model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && /prop/i.test(mesh.name)) propMeshes.push(mesh);
    });
    const center = new THREE.Vector3();
    const inverse = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    const local = new THREE.Matrix4();
    const point = new THREE.Vector3();
    let count = 0;
    for (const mesh of propMeshes) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      local.multiplyMatrices(inverse, mesh.matrixWorld);
      point.copy(mesh.geometry.boundingBox!.getCenter(new THREE.Vector3())).applyMatrix4(local);
      center.add(point);
      count++;
    }
    for (const mesh of propMeshes) mesh.removeFromParent();
    if (count === 0) return;
    center.multiplyScalar(1 / count);

    const size = new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.055;

    const propeller = new THREE.Group();
    propeller.position.copy(center);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.14, radius * 0.1, radius * 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, metalness: 0.4 }),
    );
    hub.rotation.x = Math.PI / 2;
    propeller.add(hub);

    const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.1 });
    for (let i = 0; i < 2; i++) {
      const holder = new THREE.Group();
      holder.rotation.z = i * Math.PI;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(radius, radius * 0.24, radius * 0.05), bladeMaterial);
      blade.position.x = radius * 0.5;
      holder.add(blade);
      propeller.add(holder);
    }

    const blurMaterial = new THREE.MeshBasicMaterial({
      color: 0x2b2b2b,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.propellerBlur = blurMaterial;
    propeller.add(new THREE.Mesh(new THREE.CircleGeometry(radius, 24), blurMaterial));

    this.model.add(propeller);
    this.propeller = propeller;
  }
}

let cachedGlow: THREE.Texture | null = null;
/** Soft radial glow sprite texture (for the navigation lights). */
function glowTexture(): THREE.Texture {
  if (cachedGlow) return cachedGlow;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  cachedGlow = new THREE.CanvasTexture(canvas);
  cachedGlow.colorSpace = THREE.NoColorSpace;
  return cachedGlow;
}
