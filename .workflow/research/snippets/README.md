# 调研留存参考代码

清理 `.workflow/evidence/` 时保留的 6 组后续里程碑直接引用过的最小实现参考（结论与决策见 `.workflow/decisions.md`、`docs/` 与 `.workflow/research/`）：

- `convert_ncnn.py` — `4x-NMKD-YandereNeo` `.pth` 转 ncnn 的 pnnx 脚本（M3，`handoff-defaults.md`）
- `scheduler/` — 五表 DDL、调度核心、确定性模拟器与安全/活性测试（M1，`pi-scaffolding.md`）
- `import/` — TXT 编码检测、分章规则与 EPUB 四级提取（M1/M4）
- `prompts/` — R3 实测验证的文本管线提示词初稿（M1）
- `editor/idtrack5.mjs` — CodeMirror `.nvs` 行 ID 跟踪 `StateField`（M2）
- `image/` — 图片技术检查、4:3 安全区检查与提示词参考（M1b）
