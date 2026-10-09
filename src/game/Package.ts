import * as THREE from 'three';
import type { Globe } from '../world/Globe';
import { cloneModel } from '../world/models';
import { Parachute } from './Parachute';

/** Crate model is normalised to 0.9 units, so its top is at +0.45 local. */
const CRATE_TOP = 0.45;
/** Parachute canopy scale and its height above the package origin. */
const PARACHUTE_SCALE = 1.6;
const CHUTE_HEIGHT = 1.7;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A dropped delivery package (port of Package.cs): falls under gravity toward the planet
 * centre, opens a parachute after `parachuteOpenTime`, then lands on the terrain (or ocean).
 */
export class Package {
  readonly object = new THREE.Group();

  landed = false;
  surfaceInfo: { point: THREE.Vector3; countryName: string } | null = null;
  reported = false;

  private velocity = new THREE.Vector3();
  private timeSinceDrop = 0;
  private readonly gravity = 9;
  private readonly parachuteAirResistance = 0.5;
  // Open the chute early enough that it always deploys before the crate reaches the ground.
  private readonly parachuteOpenTime = 0.6;
  private readonly parachute: Parachute;
  private readonly up = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    startPosition: THREE.Vector3,
    startVelocity: THREE.Vector3,
    private readonly globe: Globe,
    crateModel: THREE.Group | null = null,
  ) {
    this.velocity.copy(startVelocity);

    if (crateModel) {
      this.object.add(cloneModel(crateModel));
    } else {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.6, 1.6),
        new THREE.MeshStandardMaterial({ color: 0xb07a3a, roughness: 0.8 }),
      );
      this.object.add(crate);
    }

    this.parachute = new Parachute({
      scale: PARACHUTE_SCALE,
      loadLocalY: (CRATE_TOP - CHUTE_HEIGHT) / PARACHUTE_SCALE,
    });
    this.parachute.object.position.y = CHUTE_HEIGHT;
    this.object.add(this.parachute.object);

    this.object.position.copy(startPosition);
  }

  update(dt: number): void {
    this.timeSinceDrop += dt;

    this.up.copy(this.object.position).normalize();
    this.velocity.addScaledVector(this.up, -this.gravity * dt);

    if (this.timeSinceDrop > this.parachuteOpenTime) {
      this.parachute.open();
      // Drag: a = -v * |v| * k  (upstream parachuteAirResistance).
      const speed = this.velocity.length();
      this.velocity.addScaledVector(this.velocity, -speed * this.parachuteAirResistance * dt);
    }

    this.object.position.addScaledVector(this.velocity, dt);
    this.object.quaternion.setFromUnitVectors(UP, this.up);
    this.parachute.update(dt);

    this.dir.copy(this.object.position).normalize();
    const info = this.globe.sampleSurface(this.dir);
    if (info && this.object.position.length() <= info.point.length()) {
      this.object.position.copy(info.point);
      this.surfaceInfo = info;
      this.landed = true;
      this.parachute.startCrumple();
    }
    // Fell into the sea (no terrain hit and below the ocean shell).
    if (!this.landed && this.object.position.length() <= this.globe.radius) {
      this.object.position.normalize().multiplyScalar(this.globe.radius);
      this.surfaceInfo = null;
      this.landed = true;
      this.parachute.startCrumple();
    }
  }

  dispose(): void {
    this.parachute.dispose();
    this.object.removeFromParent();
  }
}
