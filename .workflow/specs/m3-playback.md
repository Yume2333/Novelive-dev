# M3 完整播放器与本地放大

**Status:** in progress
**Priority:** high
**Blocked by:** m2-editor/08

## What this is for

交付完整横屏播放器，并可在 Linux 试打包真实验证本地放大。

## What it does

补齐舞台演出、文本和 CJK 排版、播放控制、存档/已读/跨章回滚、目录重看和制作中章末等待；接入本地三档放大，支持关闭、单次及双重后处理与存量资产回填。

## How it is built

按 `docs/player.md` 使用 Pixi 舞台和 DOM 文本，两层排版分页；存档/历史只保存引用与状态，工具链按 `docs/architecture.md` 和 handoff。播放器继续不依赖 creator。

## What it must not do

不做竖屏、网页播放器、BGM、Live2D 或公开发布；本阶段 Linux 安装包仅本机试验。

## How we will know it works

- **W1.** 同一工程在实际 Electron 展示镜头、CG、前景、粒子、滤镜/遮罩及文字标签、注音、分段变速；并对比四类横屏铺满裁切和应用原型。
- **W2.** 验证导航和快存/普通存读档、已读、回滚与前滚分岔、目录重看、制作章末等待自动载入；存档回到句首屏，主线不被重看倒退。
- **W3.** 本机 Linux 试安装能运行 ncnn 和完整播放器；三档、透明立绘、WebP、2K/4K 与存量回填用实际图片验证。权重总计≤25 MiB，压缩安装包相比同配置不含放大资源增加≤40 MiB；在报告注明的 Linux Vulkan 参考机上，以预热后的 1024px→2K 样本测试默认档，P95 ≤20 秒；记录单、双次及关闭的耗时和平台。
