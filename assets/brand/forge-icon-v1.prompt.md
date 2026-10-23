# Forge icon v1

Generated with the built-in ImageGen tool on 2026-10-23.

- Asset: `forge-icon-v1.png`.
- Actual output: 1254 x 1254 RGBA PNG with transparent outer corners; the generator returned a larger canvas than the requested 1024 x 1024. The original output is preserved without resizing.
- Direction: terracotta rounded tile with an ivory italic `f.` monogram.
- Current interface references: `../../src/renderer/styles/workspace-theme.css` and `../../src/renderer/components/workbench/Welcome.tsx`.
- The workspace theme overrides the base color tokens. This icon follows the current terracotta accent, not the older sage palette described in parts of `DESIGN.md`.
- Delivered as a standalone image asset; application icons and interface references have not been replaced.

## Generation prompt

```text
Use case: logo-brand.
Asset type: one production-ready square application icon for Forge, an original professional coding and local-task workbench.
Primary request: create a refined app icon that feels like an intentional evolution of Forge's CURRENT visual identity: warm off-white UI #faf9f6, warm charcoal typography #292824, terracotta accent #a54f35, restrained rounded surfaces and generous whitespace. The current home screen has an italic serif "f." signature, so preserve that recognizable idea rather than inventing an unrelated symbol.
Composition: one centered, front-facing rounded-square terracotta tile on a genuinely transparent canvas, square 1024 by 1024 composition. Tile fills about 90 percent of the canvas, evenly inset, corners with smooth continuous curvature, radius approximately 22 percent of tile width.
Subject: an exquisitely drawn, bold, slightly forward-leaning lowercase serif f followed by one round period, together forming a single compact custom "f." monogram. Warm ivory #faf9f6 monogram on solid muted terracotta #a54f35. Give the f a graceful upper hook, a strong short crossbar, a confident tapered stem and restrained soft wedge serifs. The dot is substantial enough to survive small icon sizes and sits near the baseline, closely paired with the f. The monogram should be optically centered as a whole, filling about 60 percent of the tile height with generous negative space. Strong simple silhouette, thick enough for 32px visibility, no delicate hairlines. The f must read as a lowercase f, not a capital F, not a music note, not a flourish.
Style: clean flat vector-like logo rendering, quiet precision, tactile warmth achieved through color and shape only. Crisp anti-aliased edges, exquisite optical balance. No gradients, no grain, no texture, no glow, no dimensional extrusion, no perspective, no glossy bevel, no shadows, no border.
Text (verbatim): "f." as the central monogram ONLY. No full Forge wordmark, captions, label, watermark, extra symbol, star, flame, anvil, hammer, coding brackets or decorative element.
Deliver only the single usable icon, not a presentation board, not a mockup, not multiple alternatives. Keep the area outside the rounded tile truly transparent, not white and not a baked-in checkerboard.
```
