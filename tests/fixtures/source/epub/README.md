# EPUB 合成用例

`tests/unit/m4-epub.test.ts` 使用已安装的 zip.js 在内存生成小型 EPUB，不含真书、私有数据或网络资源。正文、目录、NCX 与 2×2 SVG 均为合成内容；修改条目覆盖四级回退、同文件锚点、分卷、跨文件顺序、图片位置与错误输入。

视觉分类复用 `artJson` → `createReplayFetch`；单元测试的三个标签用显式 mock 验证，另有真实 strict 缺档拒绝测试，禁止网络降级。这不等于成功模型回放。尚需协调者提供角色匹配、场景匹配、无关装饰三个 EPUB 分类 cassette；未录制新 cassette，未调用付费模型。
