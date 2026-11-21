// tools/patch-sharp.mjs — sharp Linux Electron 崩溃规避补丁（Electron#46323，decisions 2026-11-21）。
//
// 病因：Electron Linux 二进制已动态链接系统 glib；@img/sharp-libvips-linux-x64 的
// libvips-cpp.so 又内嵌一份私有 glib 并把 g_* 等符号全部 GLOBAL 导出。进程里两份
// glib 符号互相覆盖，第一次解码真图就 SIGSEGV（编码不崩，只有解码崩）。
//
// 对照 @janhapke/sharp-electron 的源码重编补丁（README「Engineering notes」），
// 本脚本对已安装的官方二进制做等价的链接层修补：
//   1. 把 libvips-cpp.so 拷到与 sharp-linux-x64-*.node 同目录，.node 的 RPATH 改成
//      $ORIGIN —— 强制加载同目录这份 .so（janhapke 同款布局）。
//   2. .dynsym 重写：g_*、nsgif_*、lzw_*、glib_* 导出符号 bind 改成 LOCAL（隐藏）。
//      libvips 内部对这些符号没有 UND 引用（全静态链接进自身），隐藏是安全的。
//   3. sharp 插件自身有 7 个 g_* UND 引用（g_object_ref/unref、g_free、g_malloc、
//      g_signal_connect_data、g_log_set_handler、g_utf8_validate），janhapke 在
//      编译期加了 vips_g_* 包装函数再改名指过去。我们把 .so 的 .dynsym 里这 7 个
//      g_* 条目「就地改名」成 vips_g_*（同 st_value 同 size，只换名字+bind 保
//      GLOBAL），等于免费得到同地址的导出别名；再把 .node 的 7 个 UND 用
//      objcopy --redefine-sym 改成 vips_g_*。表项复用，不扩容 .dynsym。
//
// 依赖：`patchelf`（改 RPATH）和 `objcopy`（binutils，改 .dynsym）。两者缺一退出 1。
// 用法：node tools/patch-sharp.mjs [node_modules 根，默认 ./node_modules]
//       建议挂 postinstall；sharp 升版本后重跑一次即可（幂等，可重复执行）。

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.argv[2] ?? join(process.cwd(), "node_modules");
const t0 = Date.now();

function sh(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8" });
}
function have(bin) {
  try {
    sh(bin, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

// ---------- 定位 sharp 预编译二进制（覆盖 pnpm .pnpm 与平铺两种布局） ----------
function findFiles(root, re) {
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (re.test(e.name)) hits.push(p);
    }
  };
  walk(root, 0);
  // pnpm 硬链接同 inode：按 inode 去重
  const seen = new Set();
  return hits.filter((p) => {
    const ino = statSync(p).ino;
    if (seen.has(ino)) return false;
    seen.add(ino);
    return true;
  });
}

// ---------- ELF64-LE .dynsym 最小重写器 ----------
const SHT_DYNSYM = 11;
const STB_LOCAL = 0;
const STB_GLOBAL = 1;
const STB_WEAK = 2;
const STT_FUNC = 2;
const SHN_UNDEF = 0;
const SYM_SIZE = 24;

function parseElf(buf) {
  if (buf.readUInt32BE(0) !== 0x7f454c46) throw new Error("not ELF");
  if (buf[4] !== 2 || buf[5] !== 1)
    throw new Error("只支持 ELF64 little-endian");
  const e_shoff = Number(buf.readBigUInt64LE(0x28));
  const e_shentsize = buf.readUInt16LE(0x3a);
  const e_shnum = buf.readUInt16LE(0x3c);
  const e_shstrndx = buf.readUInt16LE(0x3e);
  const sections = [];
  for (let i = 0; i < e_shnum; i++) {
    const o = e_shoff + i * e_shentsize;
    sections.push({
      nameOff: buf.readUInt32LE(o),
      type: buf.readUInt32LE(o + 4),
      addr: Number(buf.readBigUInt64LE(o + 16)),
      offset: Number(buf.readBigUInt64LE(o + 24)),
      size: Number(buf.readBigUInt64LE(o + 32)),
      link: buf.readUInt32LE(o + 40),
      entsize: Number(buf.readBigUInt64LE(o + 56)),
    });
  }
  const shstr = sections[e_shstrndx];
  for (const s of sections) {
    const abs = shstr.offset + s.nameOff;
    s.name = buf.toString("utf8", abs, buf.indexOf(0, abs));
  }
  return { buf, sections };
}

function readName(buf, str, nameOff) {
  const abs = str.offset + nameOff;
  return buf.toString("utf8", abs, buf.indexOf(0, abs));
}

/** 读 .dynsym 全部条目 */
function dynSyms(elf) {
  const { buf, sections } = elf;
  const dynsym = sections.find((s) => s.type === SHT_DYNSYM);
  if (!dynsym) throw new Error("缺 .dynsym");
  const str = sections[dynsym.link];
  const entries = [];
  const n = Math.floor(dynsym.size / SYM_SIZE);
  for (let i = 0; i < n; i++) {
    const off = dynsym.offset + i * SYM_SIZE;
    entries.push({
      idx: i,
      off,
      nameOff: buf.readUInt32LE(off),
      name: readName(buf, str, buf.readUInt32LE(off)),
      info: buf[off + 4],
      shndx: buf.readUInt16LE(off + 6),
      value: Number(buf.readBigUInt64LE(off + 8)),
    });
  }
  return { sec: dynsym, strSec: str, entries };
}

/**
 * 就地改名 + 隐藏一趟完成：
 *  - rename：命中条目只换名字（bind 归一为 GLOBAL；名字字符串写进 .dynstr
 *    所在 PT_LOAD 段尾部的零填充区）。
 *  - hide：其余命中 hidePred 的导出条目 bind 改 LOCAL。
 * 段尾空隙 = 段内最后一个占文件空间的节 end → p_offset+p_filesz。
 * 名字写进段尾后，st_name 用「相对 .dynstr 起点」的偏移；新偏移超出 .dynstr
 * 节 size 没关系 —— ELF 规范里 st_name 是对 dynstr 的索引，加载器按实际
 * 段内容读，不看节 size（readelf/objdump 同样容忍）。
 */
function rewriteDynSym(file, { rename, hidePred }) {
  const buf = readFileSync(file);
  const elf = parseElf(buf);
  const { strSec, entries } = dynSyms(elf);

  // 找 .dynstr 所在 PT_LOAD 段的文件尾
  const phoff = Number(buf.readBigUInt64LE(0x20));
  const phentsize = buf.readUInt16LE(0x36);
  const phnum = buf.readUInt16LE(0x38);
  let segEnd = buf.length;
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (buf.readUInt32LE(o) !== 1) continue; // PT_LOAD
    const poff = Number(buf.readBigUInt64LE(o + 8));
    const pfilesz = Number(buf.readBigUInt64LE(o + 32));
    if (strSec.offset >= poff && strSec.offset < poff + pfilesz) {
      segEnd = poff + pfilesz;
      break;
    }
  }
  // 新名字写进 .dynstr 内部「被释放的字节」：被隐藏的符号不再需要名字，
  // 它们的字符串在 .dynstr 里原位作废 —— 挑足够长的死名字原地覆写。
  // 这样 st_name 永远在节 size 内，加载器/readelf 完全一致。
  const freeNameRanges = []; // {off, len} 相对 .dynstr 起点
  for (const e of entries) {
    if (e.shndx === SHN_UNDEF) continue;
    const bind = e.info >> 4;
    if (bind !== STB_GLOBAL && bind !== STB_WEAK) continue;
    if (rename.has(e.name)) continue;
    if (hidePred(e.name)) {
      freeNameRanges.push({
        off: e.off ? buf.readUInt32LE(e.off) : 0,
        len: e.name.length + 1,
      });
    }
  }
  // 备用写区：.dynstr 内找不到可覆写死名字时，把新名字追加到文件尾，
  // 并把「文件里最靠后的 PT_LOAD」的 p_filesz/p_memsz 扩到文件尾。
  // 追加字节的 vaddr = 该段 vaddr + (文件偏移 - 段文件偏移)；
  // st_name = 新串 vaddr - .dynstr vaddr（DT_STRTAB 对应段内 vaddr）。
  const lastLoad = { end: 0, phdrOff: 0, off: 0, filesz: 0, vaddr: 0 };
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (buf.readUInt32LE(o) !== 1) continue;
    const poff = Number(buf.readBigUInt64LE(o + 8));
    const pfilesz = Number(buf.readBigUInt64LE(o + 32));
    if (poff + pfilesz > lastLoad.end) {
      lastLoad.end = poff + pfilesz;
      lastLoad.phdrOff = o;
      lastLoad.off = poff;
      lastLoad.filesz = pfilesz;
      lastLoad.vaddr = Number(buf.readBigUInt64LE(o + 16));
    }
  }
  const pending = [];
  const take = (need) => {
    const r = freeNameRanges.find((x) => x.len >= need && !x.used);
    if (r) {
      r.used = true;
      return r.off;
    }
    const fileOff =
      buf.length + pending.reduce((a, p) => a + p.bytes.length, 0);
    pending.push({ fileOff, bytes: Buffer.alloc(need) });
    const newVaddr = lastLoad.vaddr + (fileOff - lastLoad.off);
    return newVaddr - strSec.addr;
  };

  const report = { renamed: [], hidden: 0 };
  for (const e of entries) {
    const bind = e.info >> 4;
    if (bind !== STB_GLOBAL && bind !== STB_WEAK) continue;
    const alias = rename.get(e.name);
    if (alias) {
      if (alias.length + 1 <= e.name.length + 1) {
        // 原地覆写原名字串（新名更短，写 name\0 截断即可，st_name 不变）
        buf.write(alias + "\0", strSec.offset + e.nameOff, "utf8");
      } else {
        const dst = take(alias.length + 1);
        if (dst < 0) throw new Error(`dynstr 死名字空间不足放 ${alias}`);
        if (dst >= 0 && strSec.offset + dst < buf.length) {
          buf.write(alias + "\0", strSec.offset + dst, "utf8");
        } else {
          // 追加区：dst 是 vaddr 差，回推文件偏移再定位 pending 块
          const fileOff = dst + strSec.addr - lastLoad.vaddr + lastLoad.off;
          const p = pending.find(
            (x) =>
              fileOff >= x.fileOff &&
              fileOff + alias.length + 1 <= x.fileOff + x.bytes.length,
          );
          if (!p) throw new Error(`追加区定位失败 ${alias}`);
          p.bytes.write(alias + "\0", fileOff - p.fileOff, "utf8");
        }
        buf.writeUInt32LE(dst, e.off);
      }
      buf[e.off + 4] = (STB_GLOBAL << 4) | (e.info & 0x0f);
      report.renamed.push(`${e.name}->${alias}@${e.value.toString(16)}`);
    } else if (hidePred(e.name) && e.shndx !== SHN_UNDEF) {
      buf[e.off + 4] = (STB_LOCAL << 4) | (e.info & 0x0f);
      report.hidden++;
    }
  }
  if (pending.length) {
    const appended = Buffer.concat(pending.map((p) => p.bytes));
    const fileEnd = buf.length + appended.length;
    const newSz = fileEnd - lastLoad.off;
    buf.writeBigUInt64LE(BigInt(newSz), lastLoad.phdrOff + 32);
    buf.writeBigUInt64LE(BigInt(newSz), lastLoad.phdrOff + 40);
    writeFileSync(file, Buffer.concat([buf, appended]));
  } else {
    writeFileSync(file, buf);
  }
  report.appended = pending.length;
  return report;
}

/** GNU hash（.gnu.hash 用的 DJB 变体；charCodeAt，不是 for-of 码点字符串） */
function gnuHash(name) {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** SysV elf_hash（DT_HASH 用；charCodeAt，不是 for-of 字符串） */
function elfHash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h << 4) + name.charCodeAt(i);
    const g = h & 0xf0000000;
    if (g) h ^= g >>> 24;
    h &= ~g;
  }
  return h >>> 0;
}

/**
 * dynsym 被改名/隐藏后，原 .gnu.hash 失效：gnu.hash 的链按「桶内连续索引」
 * 寻址，改名换桶会破坏连续性（janhapke 是编译期重排 dynsym，二进制补丁做不到）。
 * 方案：把 .gnu.hash 节区改写成 SysV .hash 表（buckets/chains 链表式，与顺序无关），
 * 并把 .dynamic 的 DT_GNU_HASH(0x6ffffef5) 标签改成 DT_HASH(0x4)。
 * glibc/musl 都先找 DT_GNU_HASH，找不到就用 DT_HASH —— 等价替换。
 */
function rebuildAsSysvHash(file) {
  const buf = readFileSync(file);
  const elf = parseElf(buf);
  const { entries } = dynSyms(elf);
  const gh = elf.sections.find((s) => s.type === 0x6ffffff6);
  if (!gh) return { rebuilt: false };

  // 参与导出的符号：已定义 + bind != LOCAL（改名后 GLOBAL 的别名也在内）
  const exp = entries.filter(
    (e) => e.shndx !== SHN_UNDEF && e.info >> 4 !== STB_LOCAL,
  );
  const nbucket = 1021;
  const nchain = entries.length;
  const need = 8 + nbucket * 4 + nchain * 4;
  if (need > gh.size) throw new Error(`sysv hash 需 ${need}B > 节 ${gh.size}B`);
  const buckets = new Uint32Array(nbucket);
  const chains = new Uint32Array(nchain);
  for (const e of exp) {
    if (!e.name) continue;
    const b = elfHash(e.name) % nbucket;
    chains[e.idx] = buckets[b];
    buckets[b] = e.idx;
  }
  const out = Buffer.alloc(need);
  out.writeUInt32LE(nbucket, 0);
  out.writeUInt32LE(nchain, 4);
  for (let i = 0; i < nbucket; i++) out.writeUInt32LE(buckets[i], 8 + i * 4);
  const base = 8 + nbucket * 4;
  for (let i = 0; i < nchain; i++) out.writeUInt32LE(chains[i], base + i * 4);
  buf.set(out, gh.offset);

  // .dynamic：DT_GNU_HASH → DT_HASH
  const dyn = elf.sections.find((s) => s.type === 6); // SHT_DYNAMIC
  if (!dyn) throw new Error("缺 .dynamic");
  let patched = false;
  for (let o = dyn.offset; o < dyn.offset + dyn.size; o += 16) {
    const tag = buf.readBigInt64LE(o);
    if (tag === 0n) break;
    if (tag === 0x6ffffef5n) {
      buf.writeBigInt64LE(4n, o); // DT_HASH
      patched = true;
    }
  }
  if (!patched) throw new Error("没找到 DT_GNU_HASH 动态项");
  writeFileSync(file, buf);
  return { rebuilt: true, exported: exp.length, nbucket };
}

// ---------- 主流程 ----------
const nodeBins = findFiles(ROOT, /^sharp-linux-x64-[\d.]+\.node$/);
const vipsLibs = findFiles(ROOT, /^libvips-cpp\.so\.[\d.]+$/);
if (!nodeBins.length) {
  console.error("patch-sharp: 找不到 sharp-linux-x64-*.node，先 pnpm install");
  process.exit(1);
}
if (!vipsLibs.length) {
  console.error("patch-sharp: 找不到 @img 的 libvips-cpp.so.*");
  process.exit(1);
}
if (!have("patchelf") || !have("objcopy")) {
  console.error("patch-sharp: 需要 patchelf 和 objcopy（binutils）");
  process.exit(1);
}

// sharp .node 里对 glib 的全部 UND（对照 janhapke 补丁的 7 个 vips_g_* 包装）。
// 别名用短名：.node 的 UND 名字原地改写，新名必须 ≤ 原名长度（字节）。
const WRAP = [
  ["g_free", "vgfre"],
  ["g_log_set_handler", "vglogseth"],
  ["g_malloc", "vgmal"],
  ["g_object_ref", "vgobjref"],
  ["g_object_unref", "vgobjunref"],
  ["g_signal_connect_data", "vgsigconn"],
  ["g_utf8_validate", "vgutf8v"],
];
const renameMap = new Map(WRAP);

for (const nodePath of nodeBins) {
  const nodeDir = dirname(nodePath);
  // 1) libvips 拷到 .node 同目录（若已是打过补丁的副本则复用原文件重打）
  const srcVips = vipsLibs.find((p) => dirname(p) !== nodeDir) ?? vipsLibs[0];
  const dstVips = join(nodeDir, srcVips.split("/").pop());
  if (!existsSync(dstVips)) copyFileSync(srcVips, dstVips);

  // 2) .node RPATH → $ORIGIN
  sh("patchelf", ["--force-rpath", "--set-rpath", "$ORIGIN", nodePath]);

  // 3) libvips：7 个 g_* 就地改名 vips_g_*，其余 g_*/nsgif_*/lzw_*/glib_* 隐藏
  const rep = rewriteDynSym(dstVips, {
    rename: renameMap,
    hidePred: (n) => /^(g_|nsgif_|lzw_|glib_)/.test(n) && !renameMap.has(n),
  });
  const gh = rebuildAsSysvHash(dstVips);

  // 4) .node 的 7 个 UND 在 .dynsym 里改名 → vips_g_*
  //    （objcopy --redefine-sym 不改 .dynsym，所以同样走 rewriteDynSym；
  //      .node 的 .dynstr 里没有可复用死名字，改写到段尾空隙。）
  rewriteDynSym(nodePath, {
    rename: renameMap,
    hidePred: () => false,
    allowSegmentTail: true,
  });

  console.log(
    `patch-sharp: ${nodePath}\n` +
      `  libvips=${dstVips}\n` +
      `  renamed=${rep.renamed.length} hidden=${rep.hidden} gnuhash=${gh.rebuilt ? gh.exported + "exp" : "skip"}`,
  );
}

console.log(`patch-sharp: done in ${Date.now() - t0}ms`);
