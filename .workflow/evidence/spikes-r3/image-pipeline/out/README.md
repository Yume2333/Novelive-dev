# out/ manifest — R3 image-pipeline experiment assets

Generated for the 《骆驼祥子》 round-3 visual-pipeline test (2026-11-21).
All finals are WebP q90 (alpha preserved for sprites). Upscaled with
`realesrgan-x4plus-anime` via `upscayl-bin` then resampled to target size.
Backgrounds/CGs at 2560×1440; sprites at 2048×3072 (4x → resample).
Thumbnails are 480×270 WebP.

Source prompts: `../src/briefs.mjs`. Raw PNGs + retry attempts: `../gen/`.

## Sprites （立绘） — character / outfit / expression

| file | character | outfit | expression | source attempt |
|---|---|---|---|---|
| sprite-xiangzi-puller.webp | xiangzi | puller （车夫短打） | calm (base) | sprite-xiangzi-puller.png |
| sprite-xiangzi-winter.webp* | xiangzi | winter （冬装棉袄） | calm (base) | sprite-xiangzi-winter.png |
| sprite-huniu-home.webp | huniu | home （浅绿夹袄） | calm (base) | sprite-huniu-home.png |
| expr-xiangzi-puller-happy.webp | xiangzi | puller | happy | attempt 3 (r3) |
| expr-xiangzi-puller-angry.webp | xiangzi | puller | angry | attempt 1 |
| expr-xiangzi-puller-sad.webp | xiangzi | puller | sad | attempt 1 |
| expr-xiangzi-puller-surprised.webp | xiangzi | puller | surprised | attempt 1 |
| expr-xiangzi-winter-{happy,angry,sad,surprised}.webp | xiangzi | winter | … | attempt 1 each |
| expr-huniu-home-happy.webp | huniu | home | happy | attempt 2 (r2) |
| expr-huniu-home-angry.webp | huniu | home | angry | attempt 2 (r2) |
| expr-huniu-home-sad.webp | huniu | home | sad | attempt 1 |
| expr-huniu-home-surprised.webp | huniu | home | surprised | attempt 2 (r2) |

\* sprite-xiangzi-winter.webp was produced by `src/upscale.mjs` (x4plus-anime).
The 12 `expr-*.webp` were produced by `src/finalize-expr.mjs` (animevideov3 x4 → 2048×3072).

## Backgrounds （背景） — place / variant

| file | place | variant |
|---|---|---|
| bg-renhe-yard.webp | renhe-yard （人和车厂院） | base (day) |
| bg-renhe-yard-night.webp | renhe-yard | night |
| bg-renhe-yard-rain.webp | renhe-yard | rain |
| bg-renhe-yard-dusk.webp* | renhe-yard | dusk |
| bg-beiping-street.webp | beiping-street （北平街道） | base (day) |
| bg-beiping-street-night.webp | beiping-street | night |
| bg-beiping-street-rain.webp* | beiping-street | rain |
| bg-beiping-street-dusk.webp* | beiping-street | dusk |

* `bg-renhe-yard-dusk.webp` / `bg-beiping-street-rain.webp` / `bg-beiping-street-dusk.webp`
  were generated after the first batch; all bg variants present.

## CGs

| file | scene | note |
|---|---|---|
| cg-cg-first-rain.webp | 祥子拉新车过雨后街道 | **v2**: sprite+place 参考重画，祥子剃头/体型/疤正确 |
| cg-cg-escape-camels.webp | 夜牵三骆驼出逃 | **v2**: sprite+design-sheet 参考重画 |
| cg-cg-first-rain-v1.webp | （旧版） 祥子拉车 | v1: 纯文本提示词 → 长发动漫头、体型偏瘦，身份错误 |
| cg-cg-escape-camels-v1.webp | （旧版） 夜牵骆驼 | v1: 同上 |

## Rejected / placeholder-needed

- `gen/mod-*` — moderation probes, evidence only, not shipped.
- `gen/design-*.png` — character design sheets (method-B reference), not sprites.
- Failed first attempts (RGB / fake checkerboard) kept in `gen/` for evidence.

## For the player demo

- Sprite on stage: use the `expr-*.webp` matching character+outfit+expression;
  base `sprite-*.webp` = `calm`.
- All sprite files share the same 2048×3072 canvas and the same subject bbox
  (fillH ≈ 0.99, cx ≈ 0.50) so expression swaps will not jump.
- `*-thumb.webp` files are the 480×270 preview thumbnails.
