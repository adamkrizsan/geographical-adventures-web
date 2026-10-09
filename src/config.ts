/**
 * Shared constants. Values mirror the upstream Unity project so the port keeps the same
 * scale and feel (see PORTING-PLAN.md §5 and TerrainHeightSettings.cs / Player.cs).
 */

/** Globe radius in world units (upstream `TerrainHeightSettings.worldRadius`). */
export const WORLD_RADIUS = 150;

/** Terrain height scale (upstream `TerrainHeightSettings.heightMultiplier`). */
export const HEIGHT_MULTIPLIER = 3;

/** Mean Earth radius in kilometres (upstream `GeoMaths.EarthRadiusKM`). */
export const EARTH_RADIUS_KM = 6371;

/** Flight model, ported verbatim from Player.cs + the Player component in Game.unity. */
export const FLIGHT = {
  minSpeed: 3,
  maxSpeed: 12,
  accelerateDuration: 2,
  boostSpeed: 25,
  speedSmoothing: 0.1,
  maxBoostTime: 30,
  boostTimeAtStart: 5,

  minElevation: 4,
  maxElevation: 22,
  changeElevationSpeed: 1,

  turnSpeedInBehindView: 50,
  turnSpeedInTopDownView: 120,
  turnSmoothTime: 0.25,

  smoothRollTime: 0.35,
  rollAngle: -35,
  smoothPitchTime: 0.5,
  maxPitchAngle: 40,
  pitchLimitSmoothDst: 3,
} as const;

/** Player start point (Game.unity Player.startPoint). */
export const PLAYER_START = {
  longitude: -17,
  latitude: 33.3,
  angle: 99.6,
  elevationT: 0.477,
} as const;


export const CAMERA = {
  // Game.unity GameCamera overrides (the prefab defaults are 60/65).
  fovSlow: 57,
  fovFast: 63,
  fovBoost: 75,
  fovSmoothTime: 0.55,
  near: 0.5,
  far: 8000,
  // From Game.unity GameCamera (lookingAheadView / lookingBehindView / top-down).
  lookingAhead: {
    offset: { x: 0, y: 3.51, z: -4.35 },
    look: { x: 0, y: -4.54, z: 6.53 },
  },
  lookingBehind: {
    offset: { x: 0, y: 3.51, z: 4.35 },
    look: { x: 0, y: -4.54, z: -6.53 },
  },
  topDown: {
    distanceAbove: 12,
    turnSpeed: 100,
    startAngle: -90,
  },
} as const;

/** Converted asset locations (see scripts/build-assets.mjs and docs/asset-pipeline.md). */
export const ASSETS = {
  meshes: {
    terrainLow: 'assets/mesh/terrain_low.bytes',
    terrainHigh: 'assets/mesh/terrain_high.bytes',
    ocean: 'assets/mesh/ocean.bytes',
    outlines: 'assets/mesh/outlines.bytes',
    mapCountries: 'assets/mesh/map_countries.bytes',
    mapOcean: 'assets/mesh/map_ocean.bytes',
  },
  tex: {
    colourWest: 'assets/tex/colour_west.jpg',
    colourEast: 'assets/tex/colour_east.jpg',
    normalWest: 'assets/tex/normal_west.jpg',
    normalEast: 'assets/tex/normal_east.jpg',
    lightMap: 'assets/tex/light_map.jpg',
    lakes: 'assets/tex/lakes.jpg',
    landMask: 'assets/tex/land_mask.png',
    oceanCol: 'assets/tex/ocean_col.jpg',
    countryIndex: 'assets/tex/country_index.png',
    waveNormalA: 'assets/tex/wave_normal_a.png',
    waveNormalB: 'assets/tex/wave_normal_b.png',
    shoreDst: 'assets/tex/shore_dst.png',
    noise: 'assets/tex/noise.png',
    crate: 'assets/tex/crate.png',
  },
  /** Country flag images, named by ISO 3166-1 alpha-2 (or curated override) code. */
  flags: 'assets/flags',
} as const;

/** Direction from the Earth's surface toward the sun (world space). */
export const SUN_DIRECTION = { x: 1, y: 0.35, z: 0.6 } as const;

