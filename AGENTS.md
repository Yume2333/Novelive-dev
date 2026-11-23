<!-- workflow:start -->
# Project workflow

Read `.workflow/standards.md` once per session before non-trivial edits. Open `.workflow/CONVENTIONS.md` or `.workflow/STYLE.md` only for the section you need. Unsure where to start: run `flow-start`.

Precedence: user instruction → `standards.md` and repo conventions → `CONVENTIONS.md` → `STYLE.md`.

## Sizing work (CONVENTIONS §3)
- **Question:** answer directly from code, tests, or docs.
- **Small change or bugfix:** edit, run tests and real path, commit. No task file, no `flow-verify`.
- **1–3 clear tasks:** `flow-break` → `flow-implement`. No spec, no `flow-close`.
- **Multi-task or boundary change:** `flow-spec` → `flow-break` → `flow-implement` → `flow-close`.
- **Unclear scope or trade-offs:** run `flow-grill` first, then follow the matching path.

## Rules
1. Check the repo before asking. Ask only about choices the user owns; pick defaults for reversible details (CONVENTIONS §1).
2. Work is done when verified on the real path. Skip redundant reruns when inputs haven't changed, never the task's `Check` or real entry-point run. If the user waives the `Check`, record `Check waived: <reason; who; date>` in `## Progress`.
3. When a plan assumption breaks, fix the plan with `flow-break` amend instead of working around it in code.
4. Leave pre-existing dirty files alone unless asked. Give parallel tasks separate worktrees under the `Worktrees:` root in `.workflow/standards.md` (CONVENTIONS §7).
5. Reuse before writing: repo → stdlib → platform → installed dependency. No guards for impossible cases, no unrequested wrappers (CONVENTIONS §8). Reply in the user's language; lead with the answer or outcome and stop when done or end with one concrete next step; deliverables carry no trial-and-error notes or AI signatures (`STYLE.md`).
<!-- workflow:end -->

## Project orientation
- 未完成交接、在途分支与 M0–M5 接手顺序：[.workflow/handoff.md](.workflow/handoff.md)。
- 产品范围、里程碑与工作流：`docs/product.md`；系统架构、目录与版本锁定：`docs/architecture.md`。
- 所有界面改动必须遵守 `DESIGN.md`（Tokens、排版、控件规格；全项目禁止系统默认滚动条，统一复用 `<ScrollArea>` / `<OverlayScrollbar>`）；界面原型位于 `prototype/src/`（`components/`、`pages/`、`shell/`、`mock/`、`styles/`）。
- 里程碑规格在 `.workflow/specs/`，开发队列在 `.workflow/tasks/`；并行与验收预算见 `.workflow/delivery-plan.md`。
- 已定决策查 `.workflow/decisions.md`；待所有者回来处理或复核的事项见 `.workflow/owner-review.md`。
