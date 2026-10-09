# Porting Plan — Geographical Adventures → Browser

> Draft v0.1 · Target: playable in a web browser (desktop first, mobile later)
> Original: [SebLague/Geographical-Adventures](https://github.com/SebLague/Geographical-Adventures) · Unity / C# · MIT

This document is the working plan. It is grounded in the actual upstream source tree
(2,192 files, 369 C# scripts, 18 compute shaders, ~700 MB of source art/data).

---

## 1. What we are porting

A small geography game by Sebastian Lague. You pilot a plane around a **miniature Earth**
and deliver packages. Core loop:

1. A random quest picks **three countries**; you choose one.
2. Find the country on the globe, fly there, drop the package.
3. Score is based on accuracy / distance; there is a **map view**, **country
   highlighting**, a **compass**, **plane trails**, boost, parachute and a day/night
   Earth with **city lights**.

Facts that constrain the port:

| Thing | Value | Source |
| --- | --- | --- |
| Scene radius | `worldRadius = 150` world units | `TerrainHeightSettings.cs` |
| Height scale | `heightMultiplier = 3` | `TerrainHeightSettings.cs` |
| Real-world scale | `EarthRadiusKM = 6371` | `GeoMaths.cs` |
| Coordinate convention | `y = sin(lat)`, `z = -cos(lon)cos(lat)`, `x = sin(lon)cos(lat)` | `GeoMaths.cs` |
| Runtime | Unity + custom SRP | repo root |

**License:** MIT, © 2024 Sebastian Lague. We may reuse code and assets, but must keep the
copyright notice and attribution (see §10).

---

## 2. Original architecture (from source)

### Systems → files

| System | Key files under `Assets/Scripts` |
| --- | --- |
| Game state machine | `Game/Misc/GameController.cs` (`InMainMenu / Playing / ViewingMap / Paused / GameOver`) |
| Globe rendering + LOD | `Game/Navigation/Globe/GlobeController.cs`, `Generation/Terrain/*` |
| Terrain generation | `Generation/Terrain/TerrainGenerator.cs`, `Generator.cs`, `LodMeshLoader.cs` |
| Mesh / outline / normals gen | `Generation/Terrain/*`, `Generation/Outline Raster/*`, `Generation/Normals/*` |
| Player + flight physics | `Game/Player/Player.cs`, `GameCamera.cs`, `Package.cs`, `Parachute.cs`, `PlaneTrails.cs` |
| Quests / delivery | `Game/Quest/QuestSystem.cs`, `QuestCreator.cs`, `CityMarker.cs`, `HotAirBalloon.cs` |
| Country highlight | `Game/Country Highlight/CountryHighlighting.cs` + `CountryHighlight.compute` |
| City lights | `Game/City Lights/*` (`.compute` spawner + instanced render) |
| Map view menu | `Menu/MapMenu.cs`, `Menu/MenuGlobe.cs` |
| Solar system / sky | `Game/Solar System/*`, `Post Processing/Effects/Atmosphere/*` |
| Localization | `Localization/*` + `Data/Localization/<lang>/*.json` |
| Input / rebinding | `Input/*` |

### Data assets (already baked — this is the porting gold)

The expensive generation output is **pre-generated and committed**:

- `Assets/Data/Terrain/Terrain Mesh.bytes` (21 MB), `Low Res/Terrain Mesh (low res).bytes` (6 MB)
- `Assets/Data/Terrain/Outline Meshes.bytes` (12 MB), `Ocean Mesh New.bytes` (6 MB)
- `Assets/Data/Terrain/Outline Paths.json` (7 MB)
- Country indices, heights, masks, ocean colour, city light points, star catalogue
- World colour/normal tiles (huge — 60–98 MB each; **must be recompressed**)

Mesh container format is documented in
`Assets/Plugins/Seb/Meshing/Internal/MeshSerializer.cs`:

```
Int32  totalByteCount
Int32  nameByteLength
byte[] name            (UTF-16)
Int32  vertexCount
float3[] vertices
Int32  indexCount
Int32[] triangleIndices
float3[] normals
float4[] texCoords
```

### The blockers

1. **Compute shaders.** 18 `.compute` files do terrain height, normals, ocean tiles,
   polygon refinement, JFA, country index mapping, city-light spawning, country
   highlighting, atmosphere LUTs. **WebGL 2 has no compute.** This alone rules out a
   naive export.
2. **Custom SRP + post stack** (bloom, FXAA, aerial perspective) — Unity-specific; must be
   re-expressed in GLSL/WGSL or dropped.
3. **Asset weight.** A straight Unity WebGL build would be hundreds of MB and still not
   support the compute pipeline.

---

## 3. Strategy options

| Option | Effort | Verdict |
| --- | --- | --- |
| **A. Unity WebGL export** of the existing project | Low attempt, high fix cost | ❌ Compute shaders unsupported in WebGL2; generation scenes have no web path; multi-hundred-MB build; weak mobile. |
| **B. Full web rewrite** (three.js/Babylon) with offline data conversion | Medium–high | ✅ Recommended. We control perf, ship small compressed assets, and can use WebGPU compute later. |
| **C. Hybrid** — preprocess Unity data offline into web assets, run a thin web runtime | Medium | ✅ This **is** the concrete form of B. |

**Recommendation: Option C/B — offline-convert the baked data, re-implement the runtime in
TypeScript + three.js, and only reach for WebGPU compute where a CPU bake is not enough.**

---

## 4. Target architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Build time (Node scripts)                                     │
│  Unity .bytes/.png/.json ──► glTF / .bin / KTX2 / JSON        │
│  * decimate + quantize meshes, bake normals                   │
│  * KTX2 (Basis) compress world tiles, mip chain               │
│  * precompute country index / highlight masks → textures      │
└──────────────────────────────────────────────────────────────┘
                              │ static, CDN-friendly assets
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Runtime (Vite + TypeScript + three.js)                        │
│  core/    GameApp, render loop, state machine                 │
│  world/   Globe (terrain mesh + LOD), Ocean, Atmosphere, Sky  │
│  entity/  Player (flight), Camera, Package, Balloon           │
│  quest/   QuestSystem, CountryRegistry, Markers, Compass      │
│  ui/      HUD, Map view, Menus (DOM overlay)                  │
│  io/      AssetLoader, Input, Save                         │
│  math/    geo (lat/lon ↔ vec3), sphere math, noise            │
└──────────────────────────────────────────────────────────────┘
```

Decisions:

- **three.js** over Babylon/PlayCanvas: smallest surface for this geometry-heavy game,
  best ecosystem for the shader work, easy WebGPU opt-in via `WebGPURenderer`.
- **Static SPA**, no backend. All data is client-side (as upstream).
- **DOM for UI** (HUD/menus) — matches the upstream uGUI menus and avoids duplicating a
  3D-UI stack.
- **WebGPU first with WebGL2 fallback** for the dynamic pieces; ship WebGL2 as the
  baseline so it runs everywhere on day one.

---

## 5. Asset pipeline (build time)

Scripts in `scripts/` (to be written) run once and commit outputs to `public/assets/`.

| Upstream source | Transform | Web output |
| --- | --- | --- |
| `Terrain Mesh (low res).bytes`, `Terrain Mesh.bytes` | Parse MeshSerializer → glTF/`.bin`, quantize positions, drop texCoords if unused | `terrain-low.glb`, `terrain-high.glb` |
| `Ocean Mesh New.bytes` | same | `ocean.glb` |
| `Outline Meshes.bytes`, `Outline Paths.json` | thin instances → typed arrays / compact JSON | `outlines.bin/json` |
| `World Tiles/Colour *.jpg`, `Normals *.jpg` | downscale + **KTX2/Basis** + mips | `tiles/colour.ktx2`, `tiles/normals.ktx2` |
| `Mask/*`, `Height/*`, `Ocean/*` | resize to POT, encode BC/ASTC or KTX2 | `.ktx2` |
| `Countries/Country Data.asset`, `Capitals.json`, `Countries (medium res).txt` | parse → normalized JSON | `countries.json`, `capitals.json` |
| `City Lights/CityLightPoints.json` (27 MB) | quantize / delta / gzip → prepacked `Float32Array` | `city-lights.bin` |
| `Stars/hygdata_v3.csv` (33 MB) | filter magnitude, pack | `stars.bin` |
| `Localization/*/*.json` | passthrough | `i18n/<lang>.json` |

Bundle budget target: **≤ 25 MB** initial load for the low-res globe; stream high-res
tiles on demand.

---

## 6. Shader / compute translation

| Upstream (Unity) | Web approach |
| --- | --- |
| `TerrainHeight.compute`, `TerrainNormalsCompute.compute` | **Don't** — baked into meshes/normal textures offline. Runtime only samples a height texture (`WorldHeightLookup`) for collision/altitude. |
| `VertexCompute.compute`, `PolygonRefiner.compute` | Offline bake (already produced the committed meshes). |
| `CountryIndexMapper.compute` | Bake `Country Index Map.png` → a single lookup texture; fragment lookup at runtime. |
| `CountryHighlight.compute` | Precompute per-country alpha masks as a texture atlas; blend in fragment shader. |
| `CityLightSpawner.compute` | Offline pack point list; render as an `InstancedMesh` / points. |
| `OceanTileCompute.compute` | Vertex displacement in a **vertex shader** (Gerstner waves, see `Waves.hlsl`). |
| `JumpFlood*.compute` | Offline (used for generation only). |
| Atmosphere LUT computes | Port LUT generation to a one-off texture bake, or run in **WebGPU compute** when available (`AtmosphereCommon.hlsl` is portable to WGSL with care). |
| `Ocean.shader`, `Terrain.shader`, `Moon.shader`, `Star.shader` | Port to `ShaderMaterial` / `NodeMaterial` GLSL. Reuse the HLSL math with light edits where possible. |
| Bloom / FXAA | Use `postprocessing` (pmndrs) or three's built-ins. |
| Aerial perspective | Port `AerialPerspectiveSimple.shader`. |

---

## 7. Phased roadmap

Each phase ends in something runnable and demoable.

### Phase 0 — Scaffolding ✅ (this repo)
- Vite + TS + three.js project, lint/typecheck, folder structure, this plan.
- **Acceptance:** `npm run dev` renders a spinning placeholder globe.

### Phase 1 — Static globe
- Asset pipeline script: parse low-res terrain/ocean `.bytes` → glTF.
- Load and render terrain + ocean at correct world radius (150) & height scale (3).
- Country index lookup texture wired (lat/lon → country id).
- **Acceptance:** photoreal-enough low-res Earth renders at 60 fps desktop; can query the
  country under any lat/lon.

### Phase 2 — Flight, camera, HUD
- Port `Player.cs` flight model (speed range, boost, pitch/roll smoothing) to a
  `Player` controller using great-circle motion.
- `GameCamera` behind/top-down views, elevation clamp via height lookup.
- HUD: compass, speedometer, altitude, distance travelled (port `Compass.cs`,
  `Speedometer.cs`).
- **Acceptance:** fly around the globe with WASD + mouse; altitude never clips terrain.

### Phase 3 — Quests & delivery
- `QuestSystem` / `QuestCreator` / `QuestUI`: three choices, choose one, target marker.
- `Package` drop physics + parachute; scoring from delivery accuracy.
- `CountryData` registry + `HotAirBalloon` targets.
- **Acceptance:** a full quest can be started, flown and completed; score saved.

### Phase 4 — Map view & country highlighting
- Globe map menu (`MapMenu.cs`, `MenuGlobe.cs`) with selection.
- Country highlight + outline rendering (baked masks).
- **Acceptance:** open map, inspect a country, highlight works.

### Phase 5 — Polish
- Atmosphere/sky, day-night, city lights, plane trails, audio (music + SFX), localization
  (port the 8 languages), settings/rebinding.
- **Acceptance:** feature parity for the "v1.0.7"-level experience.

### Phase 6 — Perf, mobile, deploy
- Budgets (see §8), adaptive quality, touch controls, static hosting + CI.
- **Acceptance:** playable on a mid-range phone; Lighthouse/perf pass; deployable build.

---

## 8. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Compute-heavy generation can't run in WebGL | High | Bake offline — the data is already committed. |
| Asset size (hundreds of MB of tiles) | High | KTX2 + downscale + stream high-res tiles lazily. |
| WebGPU availability | Medium | Ship WebGL2 baseline; WebGPU progressive enhancement. |
| Exact flight feel differs | Medium | Port `Player.cs` constants verbatim, tune with a comparison capture. |
| Shader parity (ocean/atmosphere) | Medium | Port HLSL math directly; visual-diff against screenshots. |
| Licensing/attribution drift | Low | Keep MIT notice + credits UI (`Data/Credits/Contributors.txt`). |

Performance budgets: **16.6 ms/frame desktop**, **33 ms/frame mobile**, draw calls
< 300, initial download ≤ 25 MB.

---

## 9. Licensing & attribution

- Upstream is **MIT**; include the original `LICENSE` and copyright.
- Credit Sebastian Lague and contributors in a Credits screen
  (`Assets/Data/Credits/Contributors.txt`).
- Geography data sources are listed in `Assets/Data/*/Source.txt` — preserve attribution.
- Note the upstream itch page's warning that the bundled music caused YouTube Content ID
  claims; prefer replacing audio for any public deployment.

---

## 10. Open questions

1. **Fidelity target** — "playable demo" (Phases 0–3) vs "feature parity" (through 5)?
2. **Framework** — three.js (recommended) vs Babylon.js vs raw WebGPU?
3. **Assets** — reuse upstream data directly, or regenerate from primary sources?
4. **Audio** — keep upstream music (Content ID risk) or replace?
5. **Distribution** — static host (GitHub Pages/Cloudflare) with no backend, correct?
