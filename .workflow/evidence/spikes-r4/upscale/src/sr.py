#!/usr/bin/env python3
"""spikes-r4/upscale: candidate super-resolution models on real gpt-image outputs.

Backends:
  torch  - spandrel-loaded .pth/.safetensors on CUDA (fp16 where supported), tiled
  ncnn   - upscayl-bin (the shipping binary) with a .param/.bin model, -g <gpu>
  waifu2x- nagadomi/nunif via torch.hub (local clone in work/nunif)

Each run: N passes. Pass k = model upscale (native factor) then Lanczos back to the
input size; the last pass resizes to the target size instead. pass=1 is the
"放大降噪" setting, pass=2 is "双重放大降噪", pass=3 shows where repetition goes.
RGBA: alpha is replicated to 3 channels and run through the same model (the
Real-ESRGAN 'realesrgan' alpha mode); ncnn handles RGBA internally.

Usage: python src/sr.py <model-key>[,<model-key>...] [image,...] [passes]
Writes gen/<image>--<model>--p<k>.png and appends results.jsonl.
"""
import json, os, subprocess, sys, tempfile, time

import numpy as np
import torch
from PIL import Image

D = os.path.join(os.path.dirname(__file__), '..')
M = os.path.join(D, 'models')
G = os.path.join(D, 'gen')
os.makedirs(G, exist_ok=True)

# key: (backend, file-or-name, license, note)
MODELS = {
    'ncnn-digitalart': ('ncnn', 'digital-art-4x', 'BSD-3', 'current default (= realesrgan-x4plus-anime)'),
    'ncnn-lite': ('ncnn', 'upscayl-lite-4x', 'BSD-3?', "Upscayl's lite model; md5 differs from realesr-animevideov3-x4"),
    'ncnn-animev3': ('ncnn', 'realesr-animevideov3-x4', 'BSD-3', 'documented fast tier, official realesrgan-ncnn-vulkan 20220424 weights'),
    'esrgan-anime6b': ('torch', 'RealESRGAN_x4plus_anime_6B.pth', 'BSD-3', 'same weights as digital-art-4x, torch'),
    'animevideov3': ('torch', 'realesr-animevideov3.pth', 'BSD-3', 'compact'),
    'apisr-rrdb4x': ('torch', '4x_APISR_RRDB_GAN_generator.pth', 'GPL-3.0', 'CVPR24, RRDB'),
    'apisr-rrdb2x': ('torch', '2x_APISR_RRDB_GAN_generator.pth', 'GPL-3.0', 'CVPR24, RRDB 2x'),
    'apisr-grl4x': ('torch', '4x_APISR_GRL_GAN_generator.pth', 'GPL-3.0', 'CVPR24, GRL (paper weight)'),
    'apisr-dat4x': ('torch', '4x_APISR_DAT_GAN_generator.pth', 'GPL-3.0', 'CVPR24, DAT-small'),
    'hfa2k-plksr': ('torch', '4xHFA2k_ludvae_realplksr_dysample.pth', 'CC-BY-4.0', 'RealPLKSR, 2024-07'),
    'spanimation2x': ('torch', '2x_ModernSpanimationV1.pth', 'MIT', 'SPAN 2x, 2024-04'),
    'yandereneo': ('torch', '4x-NMKD-YandereNeo.safetensors', 'WTFPL', 'ESRGAN 2021'),
    'janai-v3denoise': ('torch', '4x_IllustrationJaNai_V3denoise_DAT2.safetensors', 'CC-BY-NC-4.0', 'DAT2 2025-11, NC reference'),
    'janai-v3detail': ('torch', '4x_IllustrationJaNai_V3detail_DAT2.safetensors', 'CC-BY-NC-4.0', 'DAT2 2025-11, NC reference'),
    'ultrasharpv2': ('torch', '4x-UltraSharpV2.safetensors', 'CC-BY-NC-SA-4.0', 'DAT2 2025-05, NC reference'),
    'animesharpv4': ('torch', '2x-AnimeSharpV4_RCAN.safetensors', 'CC-BY-NC-SA-4.0', 'RCAN 2025-01, NC reference'),
    'waifu2x-art': ('waifu2x', 'art', 'MIT', 'nunif swin_unet art, scale4x noise0'),
    'waifu2x-art-n1': ('waifu2x', 'art', 'MIT', 'nunif swin_unet art, scale4x noise1'),
}

# image key: (file, target size)
IMAGES = {
    'W': ('W.png', (2560, 1440)),          # CG 16:9 -> 2K
    'T3': ('T3.png', (2560, 1707)),        # relay returned 3:2 -> long edge 2560
    'T1': ('T1.png', (2048, 3072)),        # sprite 1024x1536 -> 2048x3072
}

DEV = 'cuda'
_cache = {}


def load_torch(fname):
    import spandrel, spandrel_extra_arches
    spandrel_extra_arches.install(ignore_duplicates=True)
    if fname not in _cache:
        md = spandrel.ModelLoader(DEV).load_from_file(os.path.join(M, fname))
        md.eval()
        dt = torch.float16 if md.supports_half else torch.float32  # bf16 breaks DySample (blocky output)
        md.model.to(dt)
        _cache[fname] = (md, dt)
    return _cache[fname]


@torch.inference_mode()
def run_torch_rgb(md, dt, rgb, tile=int(os.environ.get('SR_TILE', '512')), pad=24):
    """rgb: HxWx3 float32 0..1 -> upscaled HxWx3 float32."""
    s = md.scale
    x = torch.from_numpy(rgb).permute(2, 0, 1)[None].to(DEV, dt)
    _, _, h, w = x.shape
    out = torch.zeros((1, 3, h * s, w * s), device=DEV, dtype=x.dtype)
    for y0 in range(0, h, tile):
        for x0 in range(0, w, tile):
            y1, x1 = min(y0 + tile, h), min(x0 + tile, w)
            py0, px0 = max(y0 - pad, 0), max(x0 - pad, 0)
            py1, px1 = min(y1 + pad, h), min(x1 + pad, w)
            o = md(x[:, :, py0:py1, px0:px1])
            oy, ox = (y0 - py0) * s, (x0 - px0) * s
            out[:, :, y0 * s:y1 * s, x0 * s:x1 * s] = o[:, :, oy:oy + (y1 - y0) * s, ox:ox + (x1 - x0) * s]
    return out[0].float().clamp(0, 1).permute(1, 2, 0).cpu().numpy(), s


def up_torch(fname, im):
    md, half = load_torch(fname)
    a = np.asarray(im.convert('RGBA' if im.mode == 'RGBA' else 'RGB'), dtype=np.float32) / 255
    rgb, s = run_torch_rgb(md, half, np.ascontiguousarray(a[..., :3]))
    if a.shape[2] == 4:
        al, _ = run_torch_rgb(md, half, np.ascontiguousarray(np.repeat(a[..., 3:4], 3, axis=2)))
        rgb = np.concatenate([rgb, al.mean(axis=2, keepdims=True)], axis=2)
    return Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)), s


_w2x = {}


def up_waifu2x(noise, im):
    if noise not in _w2x:
        _w2x[noise] = torch.hub.load(os.path.join(D, 'work', 'nunif'), 'waifu2x', source='local',
                                     model_type='art', method='noise_scale4x', noise_level=noise,
                                     device_ids=[0], trust_repo=True)
    return _w2x[noise].infer(im), 4


def up_ncnn(name, im):
    with tempfile.TemporaryDirectory() as t:
        i, o = os.path.join(t, 'i.png'), os.path.join(t, 'o.png')
        im.save(i)
        subprocess.run([os.path.join(D, 'bin', 'upscayl-bin'), '-i', i, '-o', o, '-m', M, '-n', name,
                        '-s', '4', '-g', os.environ.get('NCNN_GPU', '0'), '-f', 'png'],
                       check=True, capture_output=True)
        return Image.open(o).copy(), 4


def upscale(key, im):
    backend, ref, _, _ = MODELS[key]
    if backend == 'torch':
        return up_torch(ref, im)
    if backend == 'ncnn':
        return up_ncnn(ref, im)
    return up_waifu2x(1 if key.endswith('-n1') else 0, im)


def main():
    keys = sys.argv[1].split(',')
    imgs = sys.argv[2].split(',') if len(sys.argv) > 2 else list(IMAGES)
    passes = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    with open(os.path.join(D, 'results.jsonl'), 'a') as log:
        for key in keys:
            for ik in imgs:
                fname, target = IMAGES[ik]
                src = Image.open(os.path.join(D, 'in', fname))
                src.load()
                cur = src
                for p in range(1, passes + 1):
                    if DEV == 'cuda':
                        torch.cuda.synchronize()
                    t0 = time.time()
                    big, s = upscale(key, cur)
                    if DEV == 'cuda':
                        torch.cuda.synchronize()
                    dt = time.time() - t0
                    big = big.convert(src.mode)
                    final = big.resize(target, Image.LANCZOS)
                    final.save(os.path.join(G, f'{ik}--{key}--p{p}.png'))
                    cur = big.resize(src.size, Image.LANCZOS)
                    rec = {'kind': 'sr', 'model': key, 'image': ik, 'pass': p, 'scale': s,
                           'sr_out': f'{big.width}x{big.height}', 'target': f'{target[0]}x{target[1]}',
                           'sr_seconds': round(dt, 2), 'backend': MODELS[key][0],
                           'license': MODELS[key][2], 'gpu': torch.cuda.get_device_name(0)}
                    log.write(json.dumps(rec) + '\n')
                    log.flush()
                    print(f'{key:16s} {ik:3s} p{p} x{s} {dt:6.2f}s', flush=True)
            _cache.clear()
            _w2x.clear()
            torch.cuda.empty_cache()


if __name__ == '__main__':
    main()
