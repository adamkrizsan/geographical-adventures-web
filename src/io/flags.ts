import * as THREE from 'three';
import { ASSETS } from '../config';
import { loadTexture } from './textures';

/**
 * Country flags used to paint hot-air-balloon envelopes, ported from the upstream
 * `Locations.FindFlag` lookup. Flags are stored as `assets/flags/<code>.png`, where the
 * code is a lowercase ISO 3166-1 alpha-2 code (or a curated override such as `gb-sct`).
 */
const cache = new Map<string, Promise<THREE.Texture | null>>();

/** Resolve a flag code to its image URL (lowercased, matching the asset pipeline). */
export function flagUrl(code: string): string {
  return `${ASSETS.flags}/${code.toLowerCase()}.png`;
}

/**
 * Load the flag texture for a country code, cached across balloons. Resolves to `null`
 * when the flag is missing so callers can fall back to the plain-coloured envelope.
 */
export function loadFlag(code: string | null | undefined): Promise<THREE.Texture | null> {
  if (!code) return Promise.resolve(null);
  const key = code.toLowerCase();
  const existing = cache.get(key);
  if (existing) return existing;

  const pending = loadTexture(flagUrl(key)).catch((error) => {
    console.warn(`Failed to load flag "${key}"`, error);
    return null;
  });
  cache.set(key, pending);
  return pending;
}
