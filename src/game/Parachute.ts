import * as THREE from 'three';

/**
 * Port of Parachute.cs: a procedurally generated canopy (centre point + concentric rings of
 * alternating radius) with rope lines to the load. Values come from the upstream
 * `Package.prefab` Parachute component (24 points/circle, 12 circles, canopyScale 0.5,
 * inflatedHeight 0.75, indent 0.95). The canopy opens and later crumples on landing.
 */
const NUM_POINTS = 24;
const NUM_CIRCLES = 12;
const CANOPY_SCALE = 0.5;
const INFLATED_HEIGHT = 0.75;
const INDENT = 0.95;
const CUSP_T = 0;
const ROPE_THICKNESS = 0.02;
const ROPE_COUNT = NUM_POINTS / 2;
const OPEN_SPEED = 2.5;
const CRUMPLE_SPEED = 0.5;

const UP = new THREE.Vector3(0, 1, 0);

export interface ParachuteSetup {
  /** Overall scale applied to the (upstream-unit) canopy. */
  scale: number;
  /** Load/attach point in the canopy's local (pre-scale) space (ropes converge here). */
  loadLocalY: number;
}

export class Parachute {
  readonly object = new THREE.Group();
  isOpen = false;

  private readonly canopy: THREE.Mesh;
  private readonly ropes: THREE.InstancedMesh;
  private readonly ropeHelper = new THREE.Object3D();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly readPositions = new Float32Array((1 + NUM_CIRCLES * NUM_POINTS) * 3);
  private readonly readIndices = new Uint16Array(NUM_CIRCLES * NUM_POINTS * 6);
  private animT = 0.1;
  private crumpleT = 0;
  private crumpling = false;

  constructor(private readonly setup: ParachuteSetup) {
    this.canopy = new THREE.Mesh(
      this.geometry,
      new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.85, side: THREE.DoubleSide }),
    );
    this.canopy.frustumCulled = false;
    this.object.add(this.canopy);

    this.ropes = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 5),
      new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 }),
      ROPE_COUNT,
    );
    this.ropes.frustumCulled = false;
    this.object.add(this.ropes);

    this.object.scale.setScalar(setup.scale);
    this.rebuild();
  }

  open(): void {
    this.isOpen = true;
  }

  startCrumple(): void {
    this.crumpling = true;
  }

  update(dt: number): void {
    let dirty = false;
    if (this.isOpen && this.animT < 1) {
      this.animT = Math.min(1, this.animT + dt * OPEN_SPEED);
      dirty = true;
    }
    if (this.crumpling && this.crumpleT < 1) {
      this.crumpleT = Math.min(1, this.crumpleT + dt * CRUMPLE_SPEED);
      dirty = true;
    }
    if (dirty) this.rebuild();
  }

  dispose(): void {
    this.geometry.dispose();
    (this.canopy.material as THREE.Material).dispose();
    this.ropes.geometry.dispose();
    (this.ropes.material as THREE.Material).dispose();
  }

  // ---- Geometry -------------------------------------------------------------

  private calculateRadius(t: number): number {
    const y = (t - CUSP_T / 2) / (1 - CUSP_T / 2);
    return this.animT * Math.sqrt(Math.abs(1 - y * y));
  }

  /** Index of a canopy vertex; circleIndex -1 is the centre point. */
  private pointIndex(circleIndex: number, pointIndex = 0): number {
    if (circleIndex === -1) return 0;
    return circleIndex * NUM_POINTS + 1 + (pointIndex % NUM_POINTS);
  }

  private rebuild(): void {
    const crumpleScale = 1 - 0.5 * this.crumpleT;
    const anim = this.animT;
    const verts = this.readPositions;
    const idx = this.readIndices;
    let v = 0;

    // Centre point.
    verts[v++] = 0;
    verts[v++] = INFLATED_HEIGHT * anim * CANOPY_SCALE * crumpleScale;
    verts[v++] = 0;

    for (let c = 0; c < NUM_CIRCLES; c++) {
      let t = 1 - (c + 1) / NUM_CIRCLES;
      t = -t * t + 2 * t;
      const height = t * INFLATED_HEIGHT * anim * CANOPY_SCALE * crumpleScale;
      const circleRadius = this.calculateRadius(t);
      for (let p = 0; p < NUM_POINTS; p++) {
        const m = p % 2 === 0 ? 1 : INDENT;
        const radius = circleRadius * m;
        const angle = (p / NUM_POINTS) * Math.PI * 2;
        verts[v++] = Math.sin(angle) * radius * CANOPY_SCALE;
        verts[v++] = height;
        verts[v++] = Math.cos(angle) * radius * CANOPY_SCALE;
      }
    }

    let i = 0;
    for (let c = 0; c < NUM_CIRCLES; c++) {
      for (let p = 0; p < NUM_POINTS; p++) {
        idx[i++] = this.pointIndex(c - 1, p);
        idx[i++] = this.pointIndex(c, p);
        idx[i++] = this.pointIndex(c, p + 1);
        if (c > 0) {
          idx[i++] = this.pointIndex(c - 1, p);
          idx[i++] = this.pointIndex(c, p + 1);
          idx[i++] = this.pointIndex(c - 1, p + 1);
        }
      }
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geometry.computeVertexNormals();

    this.updateRopes();
  }

  private updateRopes(): void {
    const verts = this.readPositions;
    const loadY = this.setup.loadLocalY;
    const spacing = 2;
    let ropeIndex = 0;
    for (let i = 1; i < NUM_POINTS && ropeIndex < ROPE_COUNT; i += spacing, ropeIndex++) {
      const startIndex = this.pointIndex(NUM_CIRCLES - 1, i) * 3;
      const start = new THREE.Vector3(verts[startIndex], verts[startIndex + 1], verts[startIndex + 2]);
      const end = new THREE.Vector3(0, loadY, 0);
      const mid = start.clone().add(end).multiplyScalar(0.5);
      const dir = start.clone().sub(end);
      const length = dir.length() || 1e-4;
      this.ropeHelper.position.copy(mid);
      this.ropeHelper.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / length));
      this.ropeHelper.scale.set(ROPE_THICKNESS, length, ROPE_THICKNESS);
      this.ropeHelper.updateMatrix();
      this.ropes.setMatrixAt(ropeIndex, this.ropeHelper.matrix);
    }
    this.ropes.instanceMatrix.needsUpdate = true;
  }
}
