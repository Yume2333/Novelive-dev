# Agent CJK font fallback

## Reproduction

- Environment: Ubuntu Linux, Electron, `NL_REPLAY=strict`, `xvfb-run -a`.
- Fixture: `tests/e2e/m2-chat.spec.ts`, the same `streaming` capture used for `06-streaming.jpg`. The chat projection is local and makes no model calls.
- Both screenshots were captured with **no system CJK fonts**: removed the previously installed distro font with `sudo apt-get remove -y fonts-noto-cjk`, ran `fc-cache -f`, and confirmed `fc-list :lang=zh` returned no entries before and after the runs.
- For `cjk-before.png`, temporarily used the exact `packages/ui/src/styles/shell.css` and `tokens.css` from `origin/main` (`98989b1e51fdc1fc3810ccc3eeeddc2b34c3c9b8`). Restored the branch CSS for `cjk-after.png`. Both use the same streaming fixture. A throwaway `cjk-capture.spec.ts` captured screenshots and baseline computed fonts, then was deleted; no evidence-only logging or screenshot block remains in `m2-chat.spec.ts`.
- Before CSS changes, `page.evaluate` / `getComputedStyle(element).fontFamily` returned:

```text
JSON { "entry": "守塔人", "field": "年龄" }: monospace
JSON { "年龄": "五十八岁", "来源": "第一章" }: monospace
思考过程 button and title span: Arial
compare_image运行中 button: Arial
运行中 caption span: Arial
```

The reproduced cause is the UA font bypass **in an environment without system CJK fonts**: JSON uses `monospace`, buttons and their captions use Arial (not system-ui), and neither selects the available CJK webfont. `cjk-before.png` reproduces tofu in all three places while body/headings render Chinese correctly. Font installation alone had masked this bug in the earlier baseline; these replacement screenshots isolate the CSS fix without that workaround.

The desktop renderer imports `@fontsource/noto-sans-sc/chinese-simplified-400.css` in `packages/ui/src/main.tsx`; its existing emitted font assets are 1,142,552 bytes WOFF2 and 1,564,084 bytes WOFF (Chromium uses WOFF2). No font assets were added by this fix. Body/headings already select this webfont through the explicit font stacks; the fix makes controls and JSON select it too, independent of OS CJK font availability.

## After

`cjk-after.png` shows the same streaming fixture, still without system CJK fonts, with shared control inheritance and explicit CJK fallbacks. The stacks measured in the original branch verification are unchanged:

```text
思考过程 button / compare_image运行中 button:
"Hanken Grotesk", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", sans-serif

JSON pre:
ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", monospace
```

The e2e also asserts the computed CJK family on the card caption (`运行中`), reasoning button and JSON blocks. No font files or font dependencies were added.

Desktop's renderer root is `packages/ui` (`apps/desktop/electron.vite.config.ts`). Its player CSS already uses `--font-body` and shares the base reset; `packages/player` has no independent CSS. Prototype tokens/reset match the shared UI, and its player tooltip uses `--font-body`. `DESIGN.md` lists no font stacks, so needs no stack correction. The server-side placeholder SVG now explicitly lists installed platform CJK families; librsvg cannot use browser webfonts.

## Checks

Typecheck completed successfully as the first stage of `NL_REPLAY=strict pnpm check`:

```text
$ tsc --noEmit
```

After correcting token formatting, `pnpm lint` exited 0 (one existing informational `lint/style/useTemplate` notice in `tests/fixtures/text-models/build-synthetic.ts`):

```text
Checked 219 files in 84ms. No fixes applied.
Found 1 info.
```

`NL_REPLAY=strict pnpm test`:

```text
 Test Files  25 passed (25)
      Tests  351 passed (351)
```

No-system-CJK verification, including the final `m2-chat.spec.ts` with its assertions retained and evidence block removed:

`NL_REPLAY=strict xvfb-run -a pnpm test:e2e tests/e2e/m2-chat.spec.ts tests/e2e/cjk-capture.spec.ts` (the second spec was the local throwaway screenshot copy):

```text
  ✓  1 tests/e2e/m2-chat.spec.ts:289:1 › M2 chat panel pastes images, shows tools, stops, switches sessions and branches (1.0s)
  ✓  2 tests/e2e/cjk-capture.spec.ts:289:1 › M2 chat panel pastes images, shows tools, stops, switches sessions and branches (1.2s)

  2 passed (1.8s)
```

Both replacement screenshots were visually inspected: before has tofu in JSON, the reasoning title and tool status; after renders Chinese correctly in all three. No macOS/Windows runtime or separate prototype visual verification was performed. The typecheck/lint/unit results above are from the original implementation; this follow-up changes only evidence and removes test instrumentation.
