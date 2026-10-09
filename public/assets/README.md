# Assets

Converted game data goes here. **Not committed** — see
[`../../docs/asset-pipeline.md`](../../docs/asset-pipeline.md).

The scaffold works with no assets (a procedural placeholder globe is generated at runtime).

To use the real low-res globe right now, copy the upstream mesh:

```bash
cp "vendor/geographical-adventures/Assets/Data/Terrain/Low Res/Terrain Mesh (low res).bytes" \
   public/assets/terrain-low.bytes
```

`AssetLoader` will detect it and render the real terrain instead of the placeholder.
