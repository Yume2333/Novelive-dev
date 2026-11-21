# Raw trial data (for report citation)

## Hardware (this box)
- AMD Ryzen 7 8845H (16 CPU threads), Radeon 780M iGPU, NVIDIA RTX 4060 Laptop dGPU, 30GB RAM
- Vulkan 1.4: [0]=RTX4060, [1]=Radeon780M(RADV), [2]=llvmpipe(CPU). All detected by ncnn binaries.
- OS: Fedora Linux 7.3.3, Python 3.15.2, PIL 12.3.0, Node 24.18.0

## Wall-time (s) — input 1024×576 bg unless noted; -g1=Radeon780M iGPU, -g0=RTX4060, -g2/-g-1=CPU
| cmd | iGPU780M | RTX4060 | CPU | peakRSS |
|---|---|---|---|---|
| Real-CUGAN-se 4x n0 | 2.7–3.1 | ~3.0 | 11.2 (-g-1, 9.4GB) | 250MB |
| Real-CUGAN-se 2x n0 | 1.5–2.6 | 3.8 | 5.7 (-g-1, 3.0GB) | 193MB |
| Real-CUGAN-se 4x n3 | 2.47 | – | – | 245MB |
| Real-ESRGAN anime 4x | 8.6–9.5 | 6.4 | 78.7 (llvmpipe, 1.6GB) | 400MB |
| realesr-animevideov3 4x | 2.0–3.0 | – | – | 214MB |
| waifu2x-cunet 2x n0 | 1.2 | 3.9 | – | 157MB |
| startup overhead (tiny img) | 0.33 | – | – | 175MB |
Full 2K pipeline: cugan4x→lanczos-down = 3.16s; cugan2x→lanczos-up = 2.03s.

## Quality (vision-model judged, 1-10)
- Forest texture PSNR vs src (after downscale): ESRGAN-anime 39.3dB > CUGAN 37.9dB > esrganv3 33.4dB.
- Real photo (input2.jpg, 256px): CUGAN=best natural, waifu2x clean, ESRGAN-anime over-posterizes photos.
- Star-field/torii 4x: ESRGAN 7/10 > waifu2x 7/10 > CUGANpro3x 5/10 > CUGANcons 4/10 > CUGAN-n0 3/10.
  -> CUGAN softens/blocks fine high-contrast detail (stars); ESRGAN reconstructs it crisply.
- Denoise: noisy-src grain std 7.91 -> cugan_n3 0.49, cugan_n0 0.56, esrgan 0.41 (clean src=0.37).
  All three denoise; cugan_n3 visibly cleanest. No separate denoise step needed.

## Alpha (sprite 768×1024 RGBA, soft hair edges, checkerboard bg)
- Direct RGBA passthrough: alpha MAE vs bicubic ref = 0.04/255 — essentially perfect.
- No white/dark halo, no checkerboard bleed on CUGAN, ESRGANv3. Soft fade preserved.
- RGB drift at semi-transparent px = intrinsic to gradient (22 vs ref 20), not bleed.
- => No split-alpha needed; pass RGBA straight through the model.

## Constraints found
- Real-CUGAN: integer scales only (2/3/4). models-se up to 4x; models-pro only up to 3x.
  Arbitrary target (1024→2560) needs upscale-then-downscale (sharp does final resize).
- -s 1 crashes (no 1x model) => denoise-only not supported; denoise is baked into upscale models (n-1..3).
- waifu2x accepts arbitrary -s (2.5 worked: 64→128px) but quality not better than CUGAN here.
- Real-CUGAN 4x CPU peak RSS hit 9.4GB (tiled ncnn); Vulkan path stays ~250-550MB.
- esrganv3 is tiny (1.2MB weights) but lowest fidelity — only useful as size-crippled fallback.

## Sizes (binary + minimal model set, Linux)
- realcugan bin(9.7MB) + 2x-n0+4x-n0 (5MB) = ~15MB
- realesrgan bin(11.4MB) + x4plus-anime(8.9MB) = ~20MB  (full models dir=45MB)
- realesrgan bin + animevideov3-x4(1.2MB) = ~12.6MB
- waifu2x bin(8.3MB) + cunet scale2x(2.8MB) = ~11MB
- onnxruntime-node npm pkg = 307MB unpacked (rejected: too heavy, and DirectML/CoreML EPs add more)

## Python packaging (if Python kept)
- PyInstaller 6.22.3 --onedir trivial wrapper = 22MB, runs end-to-end ok.
- python-build-standalone cpython-3.12 download = 105MB tarball (uv base), before deps.

## Licenses (checked from LICENSE files / repos)
- realcugan-ncnn-vulkan binary+models: MIT (nihui, shipped LICENSE). Upstream Real-CUGAN (bilibili/ailab): MIT.
- realesrgan-ncnn-vulkan binary+models: MIT (xinntao). Real-ESRGAN repo: BSD-3-Clause. ncnn: BSD-3.
- waifu2x-ncnn-vulkan: MIT (nihui). waifu2x (nixeagle/caffe upstream): MIT.
- All ship OK under AGPL-3.0 app (permissive licenses, binary+weights redistributable).
