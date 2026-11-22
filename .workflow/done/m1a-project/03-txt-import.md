# 03: 实现 TXT 抽取与核对报告

**Effort:** m1a-project
**Blocked by:** 01
**Covers:** W2, W3
**Files:** packages/creator/src/import/txt/, packages/format/src/model/metadata.ts (paragraph ID width), tests/fixtures/source/txt/, tests/unit/m1a-txt.test.ts
**Read first:** `.workflow/specs/m1a-project.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-txt.test.ts` → 六编码、模糊候选、异常卷/章、净化和段落 ID 均通过。
**Base commit:** aafdadd254a04a306f2e8d253df91cc3fc2d6554

- [x] 遵守识别顺序和最大章长度，不引入 chardet；源文、纯正文、附注及导入核对结果保存到已约定路径。

## Progress

- Plan amended (flow-break): include the shared paragraph ID schema's documented expansion beyond four digits; require script-density evidence for unmarked legacy candidates, but trust BOM/UTF-16 byte-pair evidence. Amendment stays on the isolated branch, not the parallel session's landing branch.
- Superseded checks: short legacy samples needed an ambiguity threshold; unmarked UTF-16 needed a density gate to reject binary. Both regression cases now pass.
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/unit/m1a-txt.test.ts` → 1 file, 23 tests passed. `pnpm typecheck` exited 0; `pnpm lint` exited 0 (one pre-existing informational `useTemplate` diagnostic in `tests/fixtures/text-models/build-synthetic.ts:63`). Strict full suite: 9 files, 161 tests passed. Receipts: `.workflow/evidence/m1a-project/03-{check,typecheck,lint,suite}.txt`.
- Real path: two separate strict CLI processes imported and reopened `/home/ubuntu/novelive-checks/m1a-03-project`; 3 volumes, 6 chapters, original bytes, clean body, notes, paragraph tables, report and SQLite integrity verified. Receipt: `.workflow/evidence/m1a-project/03-real-path.txt`.
- Review: skipped — this host exposes no independent reviewer/subagent/session tool; workflow and security review must be completed at flow-close, not self-approved.
- Choices: one nonempty input line is a paragraph; explicit annotation blocks end at a blank line. Removed text (including watermarks/TOC lines) stays in notes. IDs are deterministic position-based, matching the chapter-local pNNNN contract. A single paragraph above 20000 characters is preserved and reported rather than cut mid-paragraph or discarded. A preface preceding explicit volumes gets an implicit first volume; each detected volume gets one UUID work. Existing populated projects are rejected rather than overwritten. Encoding ambiguity uses a 1.5 score margin and requires 20 characters of evidence for unmarked non-UTF-8; at most three previews are returned for explicit selection.
- Model boundary: the saved check contains deterministic import findings, not a model's semantic review. No paid/model calls or fabricated model cassette. Recording session/integration task 06 should record the organizer's `ImportCheckResult` for semantic work-information/structure review if that model pass is exercised; TXT extraction itself needs no model recording. No real-book acceptance claimed.
- Environment: loaded the installed Node/pnpm bin directories; installed patchelf 0.19.3.0 to satisfy the existing sharp postinstall, then frozen-lockfile installation succeeded. No dependency or build configuration edits.
- PR #18 review fixes: first reproduced the UTF-16BE byte-order reversal and missing English/financial-numeral sequence diagnostics with failing tests. Compare both UTF-16 decodes using byte-pair and script evidence (return both when ambiguous); normalize every numeric alphabet in the heading rules before comparing ordinals, including English names for custom volume rules. Final strict Check: 38 tests passed; full suite: 176 tests across 9 files passed. See `.workflow/evidence/m1a-project/03-review-fixes.txt`.
