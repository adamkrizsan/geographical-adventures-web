#!/usr/bin/env node
/**
 * Build browser-ready assets from the upstream Unity project.
 *
 * - Copies baked meshes (already in the runtime MeshSerializer format) unchanged.
 * - Downscales the huge source textures with macOS `sips` into compressed web formats.
 *
 * Usage:  node scripts/build-assets.mjs [--force]
 * Source: vendor/geographical-adventures  (git clone of SebLague/Geographical-Adventures)
 * Output: public/assets
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'vendor', 'geographical-adventures');
const OUT = path.join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force');

if (!fs.existsSync(SRC)) {
  console.error(`Upstream source not found at ${SRC}`);
  console.error('Run: git clone --depth 1 https://github.com/SebLague/Geographical-Adventures.git vendor/geographical-adventures');
  process.exit(1);
}

fs.mkdirSync(path.join(OUT, 'mesh'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'tex'), { recursive: true });

/** Meshes are copied verbatim (same container format the runtime parses). */
const MESHES = {
  'mesh/terrain_low.bytes': 'Assets/Data/Terrain/Low Res/Terrain Mesh (low res).bytes',
  'mesh/terrain_high.bytes': 'Assets/Data/Terrain/Terrain Mesh.bytes',
  'mesh/ocean.bytes': 'Assets/Data/Terrain/Ocean Mesh New.bytes',
  'mesh/outlines.bytes': 'Assets/Data/Terrain/Outline Meshes.bytes',
  'mesh/outline_paths.json': 'Assets/Data/Terrain/Outline Paths.json',
  'mesh/map_countries.bytes': 'Assets/Graphics/Globe Map/Meshes/Countries.bytes',
  'mesh/map_ocean.bytes': 'Assets/Graphics/Globe Map/Meshes/Ocean.bytes',
};

/** 3D models, loaded at runtime with three's FBXLoader. */
const MODELS = {
  'models/plane.fbx': 'Assets/Graphics/Aircraft/Plane.fbx',
  'models/balloon.fbx': 'Assets/Graphics/Balloon/Models/Hot Air Balloon.fbx',
  'models/crate.fbx': 'Assets/Graphics/Package/Crate/Model/Crate 2.fbx',
};

/** Textures: [source, output, maxDimension, format, quality] */
const TEXTURES = [
  ['Assets/Data/World Tiles/Colour West.jpg', 'tex/colour_west.jpg', 4096, 'jpeg', 80],
  ['Assets/Data/World Tiles/Colour East.jpg', 'tex/colour_east.jpg', 4096, 'jpeg', 80],
  ['Assets/Data/World Tiles/Normals West.jpg', 'tex/normal_west.jpg', 4096, 'jpeg', 78],
  ['Assets/Data/World Tiles/Normals East.jpg', 'tex/normal_east.jpg', 4096, 'jpeg', 78],
  ['Assets/Data/City Lights/Light map small.jpg', 'tex/light_map.jpg', 4096, 'jpeg', 82],
  ['Assets/Data/Mask/Lakes.jpg', 'tex/lakes.jpg', 4096, 'jpeg', 80],
  ['Assets/Data/Mask/Mask 16x8 (thin edges).png', 'tex/land_mask.png', 4096, 'png', 0],
  ['Assets/Data/Ocean/Ocean.png', 'tex/ocean_col.jpg', 4096, 'jpeg', 82],
  ['Assets/Data/Country Indices/Country Index Map.png', 'tex/country_index.png', 4096, 'png', 0],
  ['Assets/Data/Moon/MoonNormalWorld.png', 'tex/moon_normal.jpg', 2048, 'jpeg', 78],
  ['Assets/Graphics/Water/water-normal.png', 'tex/wave_normal_a.png', 512, 'png', 0],
  ['Assets/Graphics/Water/Wave A.png', 'tex/wave_normal_b.png', 512, 'png', 0],
  ['Assets/Graphics/Water/Shore Test.png', 'tex/shore_dst.png', 2048, 'png', 0],
  ['Assets/Graphics/Water/noiseTexture (1).png', 'tex/noise.png', 512, 'png', 0],
  ['Assets/Graphics/Package/Crate/Crate Texture 2.png', 'tex/crate.png', 512, 'png', 0],
  ['Assets/Graphics/Balloon/Textures/Balloon AO.png', 'tex/balloon_ao.png', 512, 'png', 0],
];

function copy(src, dst) {
  const from = path.join(SRC, src);
  const to = path.join(OUT, dst);
  if (!fs.existsSync(from)) {
    console.warn(`  ! missing source: ${src}`);
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to) && !FORCE) {
    console.log(`  = ${dst} (exists)`);
    return;
  }
  fs.copyFileSync(from, to);
  console.log(`  + ${dst}  (${(fs.statSync(to).size / 1e6).toFixed(2)} MB)`);
}

function convert(src, dst, maxDim, format, quality) {
  const from = path.join(SRC, src);
  const to = path.join(OUT, dst);
  if (!fs.existsSync(from)) {
    console.warn(`  ! missing source: ${src}`);
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to) && !FORCE) {
    console.log(`  = ${dst} (exists)`);
    return;
  }
  const args = ['-Z', String(maxDim), '-s', 'format', format];
  if (format === 'jpeg') args.push('-s', 'formatOptions', String(quality));
  args.push(from, '--out', to);
  execFileSync('sips', args, { stdio: 'ignore' });
  const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', to], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.includes('pixel'))
    .map((l) => l.split(':')[1].trim())
    .join('x');
  console.log(`  + ${dst}  ${dims}  (${(fs.statSync(to).size / 1e6).toFixed(2)} MB)`);
}

console.log('Meshes:');
for (const [dst, src] of Object.entries(MESHES)) copy(src, dst);

console.log('Models:');
for (const [dst, src] of Object.entries(MODELS)) copy(src, dst);

console.log('Textures:');
for (const [src, dst, dim, fmt, q] of TEXTURES) convert(src, dst, dim, fmt, q);

console.log('Flags:');
const flagsDir = path.join(SRC, 'Assets', 'Graphics', 'Flags');
if (fs.existsSync(flagsDir)) {
  fs.mkdirSync(path.join(OUT, 'flags'), { recursive: true });
  let count = 0;
  for (const file of fs.readdirSync(flagsDir)) {
    if (!file.toLowerCase().endsWith('.png')) continue;
    const dst = path.join(OUT, 'flags', file.toLowerCase());
    if (!fs.existsSync(dst) || FORCE) fs.copyFileSync(path.join(flagsDir, file), dst);
    count++;
  }
  console.log(`  + ${count} flag images`);
}

console.log('\nDone. Output in public/assets.');
