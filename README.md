# Geographical Adventures — Web

A browser port of **Geographical Adventures** by
[Sebastian Lague](https://github.com/SebLague/Geographical-Adventures) — fly a miniature
Earth and deliver packages around the world.

- Planning / architecture: [`PORTING-PLAN.md`](./PORTING-PLAN.md)
- Asset conversion notes: [`docs/asset-pipeline.md`](./docs/asset-pipeline.md)

> **This is a derivative work (a source-level fork).** `Geographical Adventures — Web` is an
> unofficial browser port of [Sebastian Lague's Geographical Adventures](https://github.com/SebLague/Geographical-Adventures).
> The game, its design, art, music and original source code are entirely his. It's published as a
> standalone repository (no GitHub network fork needed). See [`FORK.md`](./FORK.md).

> Upstream is MIT-licensed (© 2024 Sebastian Lague). This port keeps the same license and
> attribution. See `PORTING-PLAN.md` §9.

## Status

This is a **real port** of the upstream Unity project, not a mock-up. Implemented so far:

- **World** — the actual baked terrain meshes (one per country) and ocean mesh, rendered with
  ports of `Custom/Terrain` and `Custom/Ocean` (triplanar colour/normal maps, lake specular,
  Gerstner-ish wave normals, shore foam, day/night) including **directional-light shadows**
  (the upstream `LIGHT_ATTENUATION` term) fed from a real three.js shadow map.
- **Handedness** — Unity's left-handed data is mirrored into three.js (geometry via the object
  matrix, geo math and shaders updated) so the world is not reversed.
- **Flight** — a faithful port of `Player.cs` (speed/pitch/roll, boost, elevation limits) with
  the real `Plane.fbx` model and the exact camera rig from `Game.unity`.
- **Quests** — the real curated location list (180 countries / 305 cities) with the upstream
  weighting, hot-air-balloon pickups (`HotAirBalloon.fbx`) painted with the pickup country's
  flag (upstream `Locations.FindFlag`), package drops (`Crate.fbx` + parachute), scoring and
  result messages.
- **Night** — the real `CityLightPoints` rendered as instanced night-side lights, plus the
  terrain light map.
- **Sky** — a faithful port of the upstream `AtmosphereEffect` (Hillaire EGSR2020 sky
  model): transmittance LUT, per-pixel raymarch rendered to a small LUT and upscaled, sun
  disc with bloom, and Reinhard tone mapping — plus a starfield built from the real HYG
  catalogue.
- **Controls** — match the upstream input actions (see below).

Converted assets are produced by `scripts/build-assets.mjs` and `scripts/build-data.mjs`.

### Still to do (see `PORTING-PLAN.md`)

Country highlighting / outlines, the map view, the real atmosphere raymarch, moon, audio,
localisation, menus and settings.

## Requirements

- Node.js 20+ (developed on Node 26)
- A browser with WebGL2 (WebGPU optional / progressive)

## Getting started

```bash
npm install
npm run dev        # start the dev server
npm run typecheck  # tsc --noEmit
npm run build      # type-safe production build to dist/
npm run preview    # serve the production build
```

## Controls

Bindings mirror the upstream input actions.

| Input | Action |
| --- | --- |
| `A` / `D` | Turn |
| `W` / `S` | Pitch (climb / dive) |
| `Q` / `E` | Slow down / speed up |
| `Shift` | Boost |
| `Space` | Drop package |
| `1` / `2` / `3` | Camera: looking ahead / behind / top-down |
| `H` | Show / hide the control hints |
| `N` | Toggle navigation aids (direction hint + distances) |
| `Backspace` / `Enter` | Make daytime / nighttime |

Debug helpers: `?lat=…&lon=…&heading=…&alt=…` sets the start position; `?night` starts on the
night side; `?globe` shows a whole-globe overview camera; `?sunalt=deg` places the sun at a
given altitude; `?noshadow` skips feeding the shadow map to the globe shaders; `?view=behind`
or `?view=topdown` starts in that camera mode.

## Project layout

```
src/
  core/    GameApp, input, render loop
  world/   Globe (placeholder + real terrain hook)
  entity/  Player flight controller
  ui/      HUD
  io/      AssetLoader (upstream mesh format)
  math/    geo + noise
public/assets/   converted game data goes here (not committed)
```

## Using the real game data

Converted assets are not committed (they are large). See
[`docs/asset-pipeline.md`](./docs/asset-pipeline.md) and drop outputs into
`public/assets/`. `AssetLoader` picks them up automatically when present and falls back to
the procedural globe otherwise.
