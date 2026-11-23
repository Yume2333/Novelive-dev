# Agent CJK font fallback

## Reproduction

- Environment: Ubuntu Linux, Electron, `NL_REPLAY=strict`, `xvfb-run -a`.
- Fixture: `tests/e2e/m2-chat.spec.ts`, the same `streaming` capture used for `06-streaming.jpg`. The chat projection is local and makes no model calls.
- Initially `fc-list :lang=zh` returned no entries. Installed distro fonts with `sudo apt-get install -y fonts-noto-cjk` before capturing the requested baseline.
- `cjk-before.png` is **before the CSS change, after font installation**. Chinese already renders correctly there. Font installation alone removes the tofu seen in the original `06-streaming.jpg`.
- Before CSS changes, `page.evaluate` / `getComputedStyle(element).fontFamily` returned:

```text
JSON { "entry": "守塔人", "field": "年龄" }: monospace
JSON { "年龄": "五十八岁", "来源": "第一章" }: monospace
compare_image运行中 button: Arial
```

The UA font bypass is real, but the button uses Arial here, not system-ui. Missing OS CJK fonts explain why those generic/control-font paths previously lacked Chinese glyphs. Body/headings instead use the explicit stack and the existing Noto Sans SC webfont imported in `packages/ui/src/main.tsx`. The original screenshot's runtime was not inspected; its causal explanation is inferred from that screenshot plus the reproduced CSS paths and font-installation result.

## After

`cjk-after.png` shows the same streaming fixture with shared control inheritance and explicit CJK fallbacks. Computed fonts:

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

`NL_REPLAY=strict NL_CJK_EVIDENCE=.workflow/evidence/m2-editor/cjk-after.png xvfb-run -a pnpm test:e2e tests/e2e/m2-chat.spec.ts`:

```text
  ✓  1 tests/e2e/m2-chat.spec.ts:289:1 › M2 chat panel pastes images, shows tools, stops, switches sessions and branches (1.2s)

  1 passed (1.8s)
```

Screenshots were visually inspected: Chinese JSON, reasoning title and tool status render without tofu. No macOS/Windows runtime or separate prototype visual verification was performed.
