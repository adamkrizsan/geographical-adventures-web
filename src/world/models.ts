import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ASSETS } from '../config';
import { loadTexture } from '../io/textures';

/** Runtime loader for the upstream Unity FBX models (plane, balloon, crate). */
const loader = new FBXLoader();

export interface ModelLibrary {
  plane: THREE.Group | null;
  balloon: THREE.Group | null;
  crate: THREE.Group | null;
}

/**
 * Load an FBX and return a group that is centred on its origin and uniformly scaled so its
 * largest dimension equals `targetSize` world units.
 */
export async function loadModel(url: string, targetSize: number, alignBase = false): Promise<THREE.Group> {
  const object = await loader.loadAsync(url);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / maxDim;

  object.scale.multiplyScalar(scale);
  object.position.set(
    -center.x * scale,
    alignBase ? -box.min.y * scale : -center.y * scale,
    -center.z * scale,
  );

  const group = new THREE.Group();
  group.add(object);
  return group;
}

/** Replace every mesh material in a model using a name-based palette (fallback colour). */
export function applyPalette(object: THREE.Object3D, palette: Record<string, number>, fallback: number): void {
  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const name = source?.name ?? '';
    const colour = palette[name] ?? fallback;
    mesh.material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6, metalness: 0.1 });
  });
}

/** Deep-clone a model (geometry + materials shared) for repeated use. */
export function cloneModel(model: THREE.Group): THREE.Group {
  return model.clone(true);
}

/** The plane's main body colour (see {@link applyPlanePalette}). */
export const PLANE_YELLOW = 0xf2c12e;

/**
 * Colour the plane by mesh name. The Plane.fbx materials have generic names (A/B/C/
 * __DEFAULT/Flaps), so a name-based palette is used to give the aircraft a yellow livery
 * with dark prop/gear and grey control surfaces.
 */
function applyPlanePalette(object: THREE.Object3D): void {
  const dark = 0x24272b;
  const darkTrim = 0xd9a316;
  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const name = mesh.name.toLowerCase();
    if (name.includes('prop_circle')) {
      // Propeller blur disc — a soft, mostly-transparent dark disc.
      mesh.material = new THREE.MeshBasicMaterial({
        color: dark,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      return;
    }
    let colour = PLANE_YELLOW;
    if (name.includes('prop')) colour = dark;
    else if (name.includes('window')) colour = 0x0e1620;
    else if (name.includes('wheel')) colour = 0x1a1a1a;
    else if (name.includes('flap')) colour = 0x9aa0a6;
    else if (name.includes('aileron') || name.includes('elevator') || name.includes('rudder')) colour = darkTrim;
    mesh.material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.55, metalness: 0.12 });
  });
}

export async function loadModels(base = 'assets/models'): Promise<ModelLibrary> {
  const [plane, balloon, crate, crateTexture] = await Promise.all([
    safeLoad(`${base}/plane.fbx`, 1.7, false),
    safeLoad(`${base}/balloon.fbx`, 9, true),
    safeLoad(`${base}/crate.fbx`, 0.9, false),
    loadTexture(ASSETS.tex.crate).catch(() => null),
  ]);

  if (plane) {
    applyPlanePalette(plane);
  }
  if (crate) {
    applyCrateMaterial(crate, crateTexture);
  }
  if (balloon) {
    applyPalette(balloon, { Balloon: 0xd94b3a }, 0xd94b3a);
  }

  return { plane, balloon, crate };
}

/** Apply the crate texture (upstream `Crate Material`) to the package model. */
function applyCrateMaterial(object: THREE.Object3D, texture: THREE.Texture | null): void {
  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.material = new THREE.MeshStandardMaterial({
      map: texture,
      color: texture ? 0xffffff : 0xb07a3a,
      roughness: 0.85,
      metalness: 0.02,
    });
  });
}

async function safeLoad(url: string, size: number, alignBase: boolean): Promise<THREE.Group | null> {
  try {
    return await loadModel(url, size, alignBase);
  } catch (error) {
    console.warn(`Failed to load model ${url}`, error);
    return null;
  }
}
