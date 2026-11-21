// sharp Linux 崩溃规避（Electron#46323）：Linux 用打过补丁的 sharp（decisions 2026-11-21）。
// M0 冒烟：解码 + 缩放 + 转 webp，验证补丁版在 utility process 里能真跑。

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

export async function sharpSmoke(
  dir: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    mkdirSync(dir, { recursive: true });
    const _out = join(dir, "sharp-smoke.webp");
    // 生成 → 缩放 → webp：触发解码和 libvips 路径
    const buf = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 200, g: 100, b: 40, alpha: 1 },
      },
    })
      .resize(32, 32)
      .webp({ quality: 80 })
      .toBuffer();
    // 再解码回像素（Electron#46323 的崩点就在解码，metadata 不算数）
    const raw = await sharp(buf).raw().toBuffer();
    const meta = await sharp(buf).metadata();
    return {
      ok: meta.width === 32 && meta.format === "webp" && raw.length > 0,
      detail: `format=${meta.format} ${meta.width}x${meta.height} raw=${raw.length}B`,
    };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}
