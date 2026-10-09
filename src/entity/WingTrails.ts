import * as THREE from 'three';

/**
 * Port of `PlaneTrails.cs` — a white contrail streaming from each wingtip. Upstream uses
 * `TrailRenderer`s with a 3 s lifetime; here each trail is a camera-facing ribbon mesh built
 * from points sampled **every frame** (so it follows the wingtip's curve at any speed) that
 * are dropped once older than `TRAIL_TIME`.
 */
const TRAIL_TIME = 2.4;
const MAX_POINTS = 160;
/** Skip duplicate points when barely moving. */
const MIN_DISTANCE = 0.015;
/** Upstream width curve starts at ~0.058 world units at the head. */
const HEAD_WIDTH = 0.06;

class Trail {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(MAX_POINTS * 2 * 3);
  private readonly material: THREE.MeshBasicMaterial;
  private readonly points: THREE.Vector3[] = [];
  private readonly times: number[] = [];
  private elapsed = 0;
  private readonly side = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();
  private readonly prevSide = new THREE.Vector3();

  constructor() {
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    const index = new Uint16Array((MAX_POINTS - 1) * 6);
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      index.set([a, b, c, b, d, c], i * 6);
    }
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  update(dt: number, tip: THREE.Vector3, cameraPos: THREE.Vector3, alpha: number): void {
    this.material.opacity = alpha;
    this.elapsed += dt;

    const last = this.points[this.points.length - 1];
    if (!last) {
      this.points.push(tip.clone());
      this.times.push(this.elapsed);
    } else if (last.distanceToSquared(tip) > MIN_DISTANCE * MIN_DISTANCE) {
      this.points.push(tip.clone());
      this.times.push(this.elapsed);
    } else {
      // Keep the head pinned to the moving wingtip.
      last.copy(tip);
    }

    // Drop points once they are older than the trail lifetime (or beyond the buffer).
    while (this.points.length > 1 && this.elapsed - this.times[0] > TRAIL_TIME) {
      this.points.shift();
      this.times.shift();
    }
    while (this.points.length > MAX_POINTS) {
      this.points.shift();
      this.times.shift();
    }

    const n = this.points.length;
    if (n < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }

    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const prev = this.points[Math.max(0, i - 1)];
      const next = this.points[Math.min(n - 1, i + 1)];
      this.dir.subVectors(next, prev);
      if (this.dir.lengthSq() < 1e-10) this.dir.set(0, 0, 1);
      this.dir.normalize();
      this.toCam.subVectors(cameraPos, p).normalize();
      this.side.crossVectors(this.dir, this.toCam);
      if (this.side.lengthSq() < 1e-10) this.side.set(1, 0, 0);
      this.side.normalize();
      // Keep the ribbon from twisting (the inside wingtip's trail can reverse direction
      // during a turn, which flipped the side vector and caused the "inner trail" glitch).
      if (i > 0 && this.side.dot(this.prevSide) < 0) this.side.negate();
      this.prevSide.copy(this.side);

      // Width tapers with age: newest (head) wide, oldest (tail) to a point.
      const age = this.elapsed - this.times[i];
      const half = HEAD_WIDTH * 0.5 * Math.max(0, 1 - age / TRAIL_TIME);
      const o = i * 6;
      this.positions[o] = p.x + this.side.x * half;
      this.positions[o + 1] = p.y + this.side.y * half;
      this.positions[o + 2] = p.z + this.side.z * half;
      this.positions[o + 3] = p.x - this.side.x * half;
      this.positions[o + 4] = p.y - this.side.y * half;
      this.positions[o + 5] = p.z - this.side.z * half;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.setDrawRange(0, (n - 1) * 6);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class WingTrails {
  readonly object = new THREE.Group();
  private readonly left = new Trail();
  private readonly right = new Trail();

  constructor() {
    this.object.add(this.left.mesh, this.right.mesh);
  }

  /** `speedT` is the player's 0..1 speed fraction. */
  update(
    dt: number,
    leftTip: THREE.Vector3,
    rightTip: THREE.Vector3,
    cameraPos: THREE.Vector3,
    speedT: number,
  ): void {
    const alpha = THREE.MathUtils.lerp(0.22, 0.55, THREE.MathUtils.clamp(speedT, 0, 1));
    this.left.update(dt, leftTip, cameraPos, alpha);
    this.right.update(dt, rightTip, cameraPos, alpha);
  }

  dispose(): void {
    this.left.dispose();
    this.right.dispose();
    this.object.removeFromParent();
  }
}
