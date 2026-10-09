import * as THREE from 'three';
import { cloneModel } from '../world/models';
import { loadFlag } from '../io/flags';

const UP = new THREE.Vector3(0, 1, 0);

/** Name of the balloon envelope mesh in `HotAirBalloon.fbx` (upstream `balloonRenderer`). */
const ENVELOPE_MESH = 'Balloon';

/** Upstream HotAirBalloon prefab: heightAboveSurface / bobSpeed / bobAmplitude. */
const HEIGHT_ABOVE_SURFACE = 8;
const BOB_SPEED = 0.5;
const BOB_AMPLITUDE = 1.25;

/** Hot air balloon marking a package pickup point (port of HotAirBalloon.cs). */
export class HotAirBalloon {
  readonly object = new THREE.Group();
  private pickedUp = false;
  private disposed = false;
  private flagMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly basePosition = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly bobTimeOffset = Math.random() * Math.PI;

  private readonly bobSpeed = BOB_SPEED;
  private readonly bobAmplitude = BOB_AMPLITUDE;

  constructor(
    position: THREE.Vector3,
    model: THREE.Group | null = null,
    flagCode: string | null = null,
    private readonly pickupRadius = 8,
  ) {
    this.up.copy(position).normalize();

    if (model) {
      this.object.add(cloneModel(model));
    } else {
      const envelope = new THREE.Mesh(
        new THREE.SphereGeometry(2.4, 20, 14),
        new THREE.MeshStandardMaterial({ color: 0xd94b3a, roughness: 0.55, emissive: 0x3a0f0a }),
      );
      envelope.name = ENVELOPE_MESH;
      envelope.scale.y = 1.25;
      envelope.position.y = 5.2;
      this.object.add(envelope);
    }

    // Float the balloon `heightAboveSurface` above the pickup point (upstream HotAirBalloon.Init).
    this.basePosition.copy(position).addScaledVector(this.up, HEIGHT_ABOVE_SURFACE);
    this.object.position.copy(this.basePosition);
    this.object.quaternion.setFromUnitVectors(UP, this.up);
    this.object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });

    // Paint the pickup country's flag onto the envelope once it loads (HotAirBalloon.cs
    // sets `balloonRenderer.material.mainTexture = flag`).
    if (flagCode) {
      void loadFlag(flagCode).then((texture) => {
        if (texture && !this.disposed) this.applyFlag(texture);
      });
    }
  }

  /** Apply a flag texture to the envelope mesh, cloning its material per balloon. */
  private applyFlag(texture: THREE.Texture): void {
    this.object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || mesh.name !== ENVELOPE_MESH) return;
      const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const material = (source as THREE.MeshStandardMaterial).clone();
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
      mesh.material = material;
      this.flagMaterial = material;
    });
  }

  /** Returns true once when the player first comes within range (only if `canPickup`). */
  update(playerPosition: THREE.Vector3, elapsed: number, canPickup = true): boolean {
    const bob = Math.sin((elapsed + this.bobTimeOffset) * this.bobSpeed) * this.bobAmplitude;
    this.object.position.copy(this.basePosition).addScaledVector(this.up, bob);

    if (this.pickedUp || !canPickup) return false;
    if (this.object.position.distanceTo(playerPosition) <= this.pickupRadius) {
      this.pickedUp = true;
      return true;
    }
    return false;
  }

  get consumed(): boolean {
    return this.pickedUp;
  }

  dispose(): void {
    this.disposed = true;
    this.flagMaterial?.dispose();
    this.object.removeFromParent();
  }
}

/** Marker dropped at the target city once a package lands. */
export class CityMarker {
  readonly object = new THREE.Group();
  private t = 0;

  constructor(point: THREE.Vector3) {
    const up = point.clone().normalize();
    const pin = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 5, 12),
      new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x0d3a1c }),
    );
    pin.geometry.rotateX(Math.PI);
    pin.position.y = 2.5;
    this.object.add(pin);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.5, 3.4, 24),
      new THREE.MeshBasicMaterial({ color: 0x2ecc71, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.object.add(ring);

    this.object.position.copy(point);
    this.object.quaternion.setFromUnitVectors(UP, up);
    this.object.scale.setScalar(0.001);
  }

  update(dt: number): void {
    this.t = Math.min(1, this.t + dt * 3);
    const eased = this.t * this.t * (3 - 2 * this.t);
    this.object.scale.setScalar(eased);
  }

  dispose(): void {
    this.object.removeFromParent();
  }
}
