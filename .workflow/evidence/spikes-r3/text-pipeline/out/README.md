# R3TextPipeline artifacts

Produced by running the documented creator text pipeline on 《骆驼祥子》 (24 chapters, ~138k chars, public domain) with eval `completion`/`judge` as the model. For the later player demo.

## Files

- `bible.json` — merged series-level 设定集 from 4 volume syntheses. Keys: `style` {visualStyle, narrativeTone}, `characters` {id → entry}, `relations` [], `locations` {id → entry}, `timeline` [], `foreshadowing` [], `volumes` (suggested split). Character entry fields per `docs/bible.md`: name/originalName/aliases/addressedAs/identity/personality/speechStyle/appearance/anchorFeatures/costumes[{id,description,fromChapter}]/major/firstSeenChapter/revealedChapter/knows/changes.
- `glossary.json` — array of {original, work, pronunciation, category, note}.
- `skeleton.json` — {volumeName → {summary, chapterBeats[{chapterId, beat}]}}.
- `ch01.nvs`, `ch02.nvs`, `ch23.nvs` — staged chapter scripts: writer output + fidelity repair + art-director staging patches applied. One `scene`/`source` block per scene; sentence ids `#xxxx` assigned at "save" like the app does.
- `chNN.images.json` — image manifest per chapter: [{asset, type, description}] where type ∈ sprite | background | cg | expression-diff | background-variant.

## .nvs format actually produced (as validated by `src/nvs.py`)

```
scene 标题
source p0005-p0009

@bg loc-id fade 1.2
@caption 北平 1.0
@show char/costume/expr left
char-id: dialogue text #a1b2
char-id (inner): monologue #c3d4 cont
char-id as 显示名: dialogue #e5f6
: narration #7890
@face char/costume/expr
@cg cg-id
@wait
```
- `cont` at line end = no click pause after this line. Serialized lines read `... cont #xxxx` — model writes `cont` bare and ids are appended after it at save, matching the doc's "cont 在句子 ID 前".
- Paragraph ids `pNNNN` are 1-based per chapter; `source` ranges are inclusive, contiguous, and together cover p0001..pNNNN exactly once (verified mechanically, see report §2).
- Slots: `left` `center` `right` (+ `far-left` `far-right` allowed).

## Regenerating

All code + prompts are in `spikes-r3 归档本目录 {src,prompts,work}`; token ledger at `work/usage.jsonl`. Chapter sources with `[pNNNN]` tags at `work/source/chNN.txt`（书文未归档）.
