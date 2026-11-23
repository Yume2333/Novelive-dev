"""从已校验的原始权重重建 fp16 ncnn 模型。依赖 torch CPU、spandrel、pnnx。"""
import hashlib
import pathlib
import re
import shutil
import tempfile
import urllib.request

import pnnx
import spandrel
import torch

URL = 'https://objectstorage.us-phoenix-1.oraclecloud.com/n/ax6ygfvpvzka/b/open-modeldb-files/o/4x-NMKD-YandereNeo.pth'
SHA256 = '988f57dd12e63cf7aad10192fd06518e3300b449362df2a03eb1f9774a10f8b3'
OUTPUT = pathlib.Path(__file__).resolve().parents[2] / 'bin/upscale/models'


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(2)
    with tempfile.TemporaryDirectory() as directory:
        root = pathlib.Path(directory)
        pth = root / 'model.pth'
        urllib.request.urlretrieve(URL, pth)
        if hashlib.sha256(pth.read_bytes()).hexdigest() != SHA256:
            raise ValueError('原始权重 sha256 不匹配')
        net = spandrel.ModelLoader('cpu').load_from_file(pth).model.float().eval()
        pnnx.export(net, str(root / 'm.pt'), (torch.rand(1, 3, 64, 64),),
                    (torch.rand(1, 3, 96, 80),), fp16=True)
        param = (root / 'm.ncnn.param').read_text()
        for old, new in [('in0', 'data'), ('out0', 'output')]:
            param = re.sub(r'(?<=\s)' + old + r'(?=\s|$)', new, param)
        (OUTPUT / '4x-NMKD-YandereNeo.param').write_text(param)
        shutil.copy(root / 'm.ncnn.bin', OUTPUT / '4x-NMKD-YandereNeo.bin')
    print('已写入', OUTPUT)


if __name__ == '__main__':
    main()
