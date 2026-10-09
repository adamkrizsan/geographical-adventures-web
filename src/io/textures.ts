import * as THREE from 'three';

export interface TextureOptions {
  /** Repeat on both axes (tileable textures) vs. clamp on V (equirectangular maps). */
  repeat?: boolean;
  /** Texture colour space. Colour maps may be sRGB; normals/masks must stay linear. */
  colorSpace?: THREE.ColorSpace;
  anisotropy?: number;
}

const loader = new THREE.TextureLoader();

export async function loadTexture(url: string, options: TextureOptions = {}): Promise<THREE.Texture> {
  const texture = await loader.loadAsync(url);
  texture.wrapS = options.repeat ? THREE.RepeatWrapping : THREE.RepeatWrapping;
  texture.wrapT = options.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = options.colorSpace ?? THREE.NoColorSpace;
  texture.anisotropy = options.anisotropy ?? 8;
  texture.needsUpdate = true;
  return texture;
}

export function textureSize(texture: THREE.Texture): THREE.Vector2 {
  const image = texture.image as { width?: number; height?: number } | undefined;
  return new THREE.Vector2(image?.width ?? 1, image?.height ?? 1);
}
