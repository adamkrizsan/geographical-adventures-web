import * as THREE from 'three';

/**
 * Geographic helpers. Ported from the upstream `GeoMaths.cs` so that latitude/longitude
 * map to world positions exactly as in the original game.
 *
 *   y = sin(lat)
 *   z =  cos(lon) * cos(lat)
 *   x =  sin(lon) * cos(lat)
 *
 * Note: the upstream (Unity) convention has `z = -cos(lon)*cos(lat)`. Unity is left-handed
 * and three.js is right-handed, so we negate Z throughout (mesh geometry, this math, and
 * the ported shaders) to avoid rendering a mirrored world.
 */
export interface LatLon {
  /** degrees, -90..90 */
  lat: number;
  /** degrees, -180..180 */
  lon: number;
}

export const EARTH_RADIUS_KM = 6371;

export function latLonToVector3(
  lat: number,
  lon: number,
  radius = 1,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(lat);
  const theta = THREE.MathUtils.degToRad(lon);
  const y = Math.sin(phi);
  const r = Math.cos(phi);
  const x = Math.sin(theta) * r;
  const z = Math.cos(theta) * r;
  return target.set(x * radius, y * radius, z * radius);
}

/** Inverse of {@link latLonToVector3}. Accepts any non-zero vector. */
export function vector3ToLatLon(point: THREE.Vector3, target: LatLon = { lat: 0, lon: 0 }): LatLon {
  const n = point.clone().normalize();
  target.lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)));
  target.lon = THREE.MathUtils.radToDeg(Math.atan2(n.x, n.z));
  return target;
}

/** Great-circle angle in radians between two points on a sphere (from GeoMaths.cs). */
export function angleBetween(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.atan2(new THREE.Vector3().crossVectors(a, b).length(), a.dot(b));
}

/**
 * Compass bearing in degrees (0 = north, clockwise) from `up` (a unit position) toward a
 * target unit direction, measured in the tangent plane. Mirrors Player.heading.
 */
export function compassBearing(up: THREE.Vector3, targetUnit: THREE.Vector3): number {
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
  const east = new THREE.Vector3().crossVectors(north, up).normalize();
  const dir = new THREE.Vector3().copy(targetUnit).addScaledVector(up, -up.dot(targetUnit)).normalize();
  return THREE.MathUtils.radToDeg(Math.atan2(dir.dot(east), dir.dot(north)));
}

/** Format a coordinate as `12.3°N 45.6°E`. */
export function formatLatLon({ lat, lon }: LatLon): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}
