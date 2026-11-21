import json,os,sys,time
import tiktoken
from tokenizers import Tokenizer

HF=os.path.join(os.path.dirname(os.path.abspath(__file__)),"hf")
def load_hf(repo,commit=None):
    base=f"{HF}/models--{repo.replace('/','--')}/snapshots"
    snap=os.listdir(base)[0]
    return Tokenizer.from_file(f"{base}/{snap}/tokenizer.json")

toks={}
toks['o200k_base']=lambda s: len(tiktoken.get_encoding('o200k_base').encode(s))
toks['cl100k_base']=lambda s: len(tiktoken.get_encoding('cl100k_base').encode(s))
for name,repo in [
    ('qwen2.5','Qwen/Qwen2.5-7B-Instruct'),
    ('qwen3','Qwen/Qwen3-8B'),
    ('deepseek-v3','deepseek-ai/DeepSeek-V3'),
    ('glm4','THUDM/GLM-4-9B-0414'),
    ('kimi','moonshotai/Kimi-Dev-72B'),
    ('llama3','unsloth/llama-3-8b-Instruct'),
    ('gemma2','unsloth/gemma-2-9b-it'),
    ('gemma3','unsloth/gemma-3-27b-it'),
]:
    try:
        t=load_hf(repo)
        toks[name]=(lambda t: lambda s: len(t.encode(s).ids))(t)
    except Exception as e:
        print('skip',name,e)

files=['webnovel.txt','hongloumeng.txt','nvs_sample.nvs','bible.json','bible_big.json','prompt_en.txt','chapter_3k.txt','book_300k.txt']
print(f"{'file':<20}{'chars':>8}{'bytes':>9}"+ "".join(f"{n:>12}" for n in toks))
rows={}
for fn in files:
    s=open('corpus/'+fn,encoding='utf-8',errors='replace').read()
    ch=len(s); by=len(s.encode('utf-8'))
    row={'chars':ch,'bytes':by}
    for n,f in toks.items():
        t0=time.time(); row[n]=f(s); 
    print(f"{fn:<20}{ch:>8}{by:>9}"+"".join(f"{row[n]:>12}" for n in toks))
    rows[fn]=row
json.dump(rows,open('results/tokens.json','w'),indent=1)
