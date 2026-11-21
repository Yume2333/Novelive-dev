// Shared creator library: consumed by the utility process entry in apps/desktop.
import sharp from "sharp";

export async function sharpSmoke(outPath: string): Promise<{ ok: boolean; format?: string; width?: number }> {
  // 1) generate a PNG buffer via raw pixel input (exercises encoder path)
  const px = Buffer.alloc(8 * 8 * 4, 255);
  const pngBuf = await sharp(px, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
  // 2) decode the PNG back to raw pixels (exercises decoder path — the GLib crash path)
  const { data, info } = await sharp(pngBuf).raw().toBuffer({ resolveWithObject: true });
  if (data.length !== 8 * 8 * 4 || info.width !== 8) return { ok: false };
  // 3) resize + webp encode to file
  await sharp(pngBuf).resize(4, 4).webp({ quality: 90 }).toFile(outPath);
  const meta = await sharp(outPath).metadata();
  return { ok: meta.format === "webp" && meta.width === 4, format: meta.format, width: meta.width };
}
