# Fork declaration

**Geographical Adventures — Web is a derivative work (a source-level fork) of [Sebastian Lague's Geographical Adventures](https://github.com/SebLague/Geographical-Adventures).**

This project is a **browser port**: it re-implements the original Unity game so it can run in any
modern web browser, on any computer, with nothing to install. It is a **derivative work** of the
upstream project — the game concept, design, art, music and the original source code are all by
**Sebastian Lague**, and are used here under the MIT License (Copyright © 2024 Sebastian Lague).

- Upstream repository: <https://github.com/SebLague/Geographical-Adventures>
- Play Sebastian's original: <https://sebastian.itch.io/geographical-adventures>
- Development video series: <https://www.youtube.com/watch?v=sLqXFF8mlEU&list=PLFt_AvWsXl0dT82XMtKATYPcVIhpu2fh6>

The `vendor/geographical-adventures/` directory is an unmodified clone of the upstream repository.
All trademarks, game design and assets remain the property of their original author.

## A note on repositories

This port is published as a **standalone project** and does **not** need to be a GitHub *network
fork* of the upstream. A source-level fork like this is fully covered by the MIT license, and the
attribution above is what matters — so it can happily coexist with any other fork of the upstream
that already exists (for example, an earlier, unrelated experiment). Publishing it as its own
repository is the recommended setup.

If you enjoy this, **please support Sebastian Lague** — go play his original, watch the dev series,
and star the repository. None of the credit for this game belongs to this port; all of it is his.

## What this fork changes

- Renders the globe, terrain, ocean, atmosphere, sky and city lights with three.js / WebGL2
  (ports of the upstream Unity shaders).
- Converts the upstream meshes, textures and data into web-friendly formats
  (see [`docs/asset-pipeline.md`](./docs/asset-pipeline.md)).
- Re-implements the flight model, quests and package delivery in TypeScript
  (`src/`).
- Adds a browser HUD, camera views and a welcome/credits modal.

Everything it builds on is Sebastian Lague's work. The web port merely adapts it.

## Third-party data

- **Natural Earth** — country shape data and city locations — <https://www.naturalearthdata.com>
- **NASA Visible Earth** — topography and land colour maps
- **NASA Earth Observatory** — night-time city-light map
- **Flagpedia** — country flag images — <https://flagpedia.net>
- **Astronexus / HYG Database** — star data — <https://github.com/astronexus/HYG-Database>

---

Signed,

**Krizsán Ádám** — <lovidmann@gmail.com>

2026-10-09
