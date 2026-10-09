# Asset pipeline

The upstream Unity project ships its expensive generation output as **baked binary files**.
We convert them offline (Node scripts) into web-friendly formats and serve them statically.

Nothing here is committed: converted assets are large. Scripts live in `scripts/` and write
to `public/assets/`, which is git-ignored except for its README.

## Getting the upstream source

```bash
git clone --depth 1 https://github.com/SebLague/Geographical-Adventures.git vendor/geographical-adventures
```

(MIT-licensed — keep the `LICENSE` and attributions.)

## Mesh format

`.bytes` meshes use the container documented in
`Assets/Plugins/Seb/Meshing/Internal/MeshSerializer.cs`:

```
Int32    totalByteCount
Int32    nameByteLength
byte[]   name            (UTF-16 LE)
Int32    vertexCount
float32[3 * vertexCount]  vertices
Int32    indexCount
int32[indexCount]         triangle indices
float32[3 * vertexCount]  normals
float32[4 * vertexCount]  texCoords
```

Files we care about:

| File | Size | Notes |
| --- | --- | --- |
| `Data/Terrain/Low Res/Terrain Mesh (low res).bytes` | 5.9 MB | Start here — low-res globe |
| `Data/Terrain/Terrain Mesh.bytes` | 21 MB | High-res |
| `Data/Terrain/Ocean Mesh New.bytes` | 6.1 MB | Ocean shell |
| `Data/Terrain/Outline Meshes.bytes` | 12 MB | Coastline outlines |
| `Data/Terrain/Outline Paths.json` | 7.3 MB | Path data |

## Texture conversion

World colour/normal tiles are the dominant cost (60–98 MB each as JPG):

| Source | Size | Target |
| --- | --- | --- |
| `Data/World Tiles/Colour {East,West}.jpg` | 91/62 MB | downscale + KTX2/Basis, mips |
| `Data/World Tiles/Normals {East,West}.jpg` | 98/87 MB | downscale + KTX2 |
| `Data/Mask/*`, `Data/Height/*`, `Data/Ocean/*` | 15–58 MB | POT resize + KTX2 |

Use [`toktx`](https://github.com/KhronosGroup/KTX-Software) or `basisu` for KTX2/Basis.

## JSON / data conversion

| Source | Target |
| --- | --- |
| `Data/Countries/Capitals.json` | passthrough |
| `Data/Countries/Source/Countries (medium res).txt` | normalized `countries.json` |
| `Data/City Lights/CityLightPoints.json` (27 MB) | quantized `city-lights.bin` |
| `Data/Stars/hygdata_v3.csv` (33 MB) | magnitude-filtered `stars.bin` |
| `Data/Localization/<lang>/*.json` | `i18n/<lang>.json` |

## Planned scripts

```
scripts/
  fetch-upstream.ts      # clone/pin the upstream repo
  convert-mesh.ts        # MeshSerializer bytes -> glTF / packed .bin
  convert-tiles.ts       # jpg/png -> KTX2 (requires toktx)
  convert-data.ts        # country/city/star/i18n data
```

## Budgets

- Initial download ≤ 25 MB (low-res globe + core data).
- High-res tiles streamed on demand.
- All textures KTX2/Basis with mips; meshes quantized.
