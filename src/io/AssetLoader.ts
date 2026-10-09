import * as THREE from 'three';

/**
 * Loader for upstream game data.
 *
 * Supports the Unity `MeshSerializer` container used by the `.bytes` terrain/ocean meshes,
 * so a raw upstream file dropped into `public/assets/` works without conversion:
 *
 *   Int32    totalByteCount
 *   Int32    nameByteLength
 *   byte[]   name            (UTF-16 LE)
 *   Int32    vertexCount
 *   float32[3 * vertexCount]  vertices
 *   Int32    indexCount
 *   uint32[indexCount]        triangle indices
 *   float32[3 * vertexCount]  normals
 *   float32[4 * vertexCount]  texCoords
 *
 * See docs/asset-pipeline.md.
 */
export interface SerializedMesh {
  name: string;
  vertices: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
}

export function parseMeshBytes(buffer: ArrayBuffer): SerializedMesh {
  const view = new DataView(buffer);
  let offset = 0;

  const totalBytes = view.getInt32(offset, true);
  offset += 4;
  if (totalBytes !== buffer.byteLength) {
    throw new Error(
      `Not a mesh file: header says ${totalBytes} bytes, got ${buffer.byteLength}`,
    );
  }

  const nameByteLength = view.getInt32(offset, true);
  offset += 4;
  if (nameByteLength < 0 || offset + nameByteLength > buffer.byteLength) {
    throw new Error(`Invalid mesh name length: ${nameByteLength}`);
  }
  let name = '';
  for (let i = 0; i < nameByteLength; i += 2) {
    name += String.fromCharCode(view.getUint16(offset + i, true));
  }
  offset += nameByteLength;

  const vertexCount = view.getInt32(offset, true);
  offset += 4;
  if (vertexCount < 0 || offset + vertexCount * 3 * 4 > buffer.byteLength) {
    throw new Error(`Invalid mesh vertex count: ${vertexCount}`);
  }
  const vertices = alignedFloat32(buffer, offset, vertexCount * 3);
  offset += vertexCount * 3 * 4;

  const indexCount = view.getInt32(offset, true);
  offset += 4;
  if (indexCount < 0 || offset + indexCount * 4 > buffer.byteLength) {
    throw new Error(`Invalid mesh index count: ${indexCount}`);
  }
  const indices = alignedUint32(buffer, offset, indexCount);
  offset += indexCount * 4;

  if (offset + vertexCount * 3 * 4 > buffer.byteLength) {
    throw new Error('Mesh is missing its normal array');
  }
  const normals = alignedFloat32(buffer, offset, vertexCount * 3);

  return { name, vertices, indices, normals };
}

// Unity's BinaryWriter does not pad the UTF-16 name field, so subsequent sections may not
// start on a 4-byte boundary. Copy into a fresh, aligned buffer before creating typed views.
function alignedFloat32(buffer: ArrayBuffer, offset: number, count: number): Float32Array {
  return new Float32Array(new Uint8Array(buffer, offset, count * 4).slice().buffer);
}

function alignedUint32(buffer: ArrayBuffer, offset: number, count: number): Uint32Array {
  return new Uint32Array(new Uint8Array(buffer, offset, count * 4).slice().buffer);
}

/**
 * Parse a file containing one or more concatenated serialized meshes
 * (`MeshSerializer.MeshesToBytes` writes `MeshToBytes` back to back).
 */
export function parseMeshFile(buffer: ArrayBuffer): SerializedMesh[] {
  const view = new DataView(buffer);
  const meshes: SerializedMesh[] = [];
  let offset = 0;
  while (offset < buffer.byteLength) {
    const totalBytes = view.getInt32(offset, true);
    if (totalBytes <= 0 || offset + totalBytes > buffer.byteLength) {
      throw new Error(`Corrupt mesh stream at byte ${offset}`);
    }
    meshes.push(parseMeshBytes(buffer.slice(offset, offset + totalBytes)));
    offset += totalBytes;
  }
  return meshes;
}

export class AssetLoader {
  /** Fetch and parse a serialized mesh, or return null if it is not present/invalid. */
  static async loadSerializedMesh(url: string): Promise<SerializedMesh | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      // Dev servers often fall back to index.html for unknown paths — reject that.
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/html')) return null;
      return parseMeshBytes(await res.arrayBuffer());
    } catch (error) {
      console.warn(`Could not load mesh from ${url}:`, error);
      return null;
    }
  }

  /** Fetch and parse a multi-mesh file. Throws if the asset is missing. */
  static async loadMeshFile(url: string): Promise<SerializedMesh[]> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load mesh file ${url}: ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) throw new Error(`Missing mesh asset: ${url}`);
    return parseMeshFile(await res.arrayBuffer());
  }

  /** Build a renderable geometry from a serialized mesh. */
  static toGeometry(mesh: SerializedMesh): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}
