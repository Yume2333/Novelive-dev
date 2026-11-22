#!/usr/bin/env python3
"""Convert 4x-NMKD-YandereNeo (OpenModelDB .pth) to an ncnn model that upscayl-bin loads.

Steps: download the original .pth, check sha256, load with spandrel, export with pnnx
(dynamic H/W via a second input shape, fp16 weights), rename the input/output blobs to
the names upscayl-bin expects (`data` / `output`).
Output: models/yandereneo-4x.{param,bin}
Run:    upscayl-bin -i in.png -o out.png -m models -n yandereneo-4x -s 4
Needs:  torch, spandrel, pnnx (pip).
"""
import hashlib, os, re, shutil, tempfile, urllib.request

import pnnx
import spandrel
import torch

URL = 'https://objectstorage.us-phoenix-1.oraclecloud.com/n/ax6ygfvpvzka/b/open-modeldb-files/o/4x-NMKD-YandereNeo.pth'
SHA256 = '988f57dd12e63cf7aad10192fd06518e3300b449362df2a03eb1f9774a10f8b3'
M = os.path.join(os.path.dirname(__file__), '..', 'models')
NAME = 'yandereneo-4x'


def main():
    os.makedirs(M, exist_ok=True)
    pth = os.path.join(M, '4x-NMKD-YandereNeo.pth')
    if not os.path.exists(pth):
        urllib.request.urlretrieve(URL, pth)
    with open(pth, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != SHA256:
        raise SystemExit(f'sha256 mismatch: {digest}')

    net = spandrel.ModelLoader('cpu').load_from_file(pth).model.float().eval()
    with tempfile.TemporaryDirectory() as t:
        pt = os.path.join(t, 'm.pt')
        pnnx.export(net, pt, (torch.rand(1, 3, 64, 64),), (torch.rand(1, 3, 96, 80),))
        with open(os.path.join(t, 'm.ncnn.param')) as f:
            param = f.read()
        param = re.sub(r'(?<=\s)in0(?=\s|$)', 'data', param, flags=re.M)
        param = re.sub(r'(?<=\s)out0(?=\s|$)', 'output', param, flags=re.M)
        with open(os.path.join(M, NAME + '.param'), 'w') as f:
            f.write(param)
        shutil.copy(os.path.join(t, 'm.ncnn.bin'), os.path.join(M, NAME + '.bin'))
    print('wrote', os.path.join(M, NAME + '.{param,bin}'))


if __name__ == '__main__':
    main()
