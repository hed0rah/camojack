# CamoJack

<img width="1024" height="1024" alt="CJ-logo" src="https://github.com/user-attachments/assets/5adc7b79-3b54-4e50-b8a6-7f092f58aa5c" />

Browser-based camouflage pattern generator and tile editor. Vanilla JS, no framework.

## Features

- 14 algorithmic pattern generators: voronoi, FBM noise, digital (MARPAT), blotch, tiger stripe, brushstroke (DPM), fleck, rain, chip, geometric, honeycomb, carbon fiber, contour (woodland M81)
- 25+ presets: woodland, multicam, DPM, flecktarn, tiger stripe, desert, splinter, kryptek, carbon, honeycomb, plus novelty (baja blast, volcano, zombie, dragon)
- 30+ curated palettes across Military / Biome / Novelty / Kryptek groups
- Extract palettes from uploaded images (k-means++)
- Seamless tile editor: wraparound brushes, auto-seam feather, offset view
- Tools: brush, eraser, smear, clone stamp, blob stamp, spray (3 types), line, rect, gradient, flood fill, eyedropper
- Stamp library: procedurally generate or import blob shapes, rotate, rescale, randomize
- Pattern blending between two generated patterns
- Undo/redo, hash-based duplicate detection
- Export single tile or tiled sheet (up to 8x8)

## Run

```
npm install
npm run dev
```

## Build

```
npm run build
```

Outputs to `dist/`.

## License

MIT
