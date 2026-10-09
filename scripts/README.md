# Build scripts (planned)

Offline conversion of upstream Unity data into web-friendly assets. See
[`../docs/asset-pipeline.md`](../docs/asset-pipeline.md).

```
fetch-upstream.ts   # pin + clone SebLague/Geographical-Adventures into vendor/
convert-mesh.ts     # MeshSerializer .bytes -> glTF / packed .bin
convert-tiles.ts    # colour/normal/mask jpg/png -> KTX2 (requires toktx)
convert-data.ts     # countries, capitals, city lights, stars, i18n
```

Not implemented yet. The runtime in `src/io/AssetLoader.ts` already reads the raw
`.bytes` mesh format, so Phase 1 can start by copying the low-res mesh directly into
`public/assets/terrain-low.bytes`.
