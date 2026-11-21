#!/usr/bin/env python3
"""Summarize results.jsonl for spikes-r4/genshin-style: counts, latency, sizes, errors."""
import json, os, sys

D = os.path.join(os.path.dirname(__file__), '..')
rows = [json.loads(l) for l in open(os.path.join(D, 'results.jsonl'))]

calls = [r for r in rows if r.get('fn') == 'edit']
saved = {r.get('name'): r for r in rows if r.get('kind') == 'saved'}
ok = [r for r in calls if r.get('kind') == 'ok']
ref = [r for r in calls if r.get('kind') == 'content_refusal']
err = [r for r in calls if r.get('kind') == 'error']

print(f'edit calls: {len(calls)}  ok={len(ok)} refusal={len(ref)} error={len(err)}')
lat = sorted(r['ms'] for r in ok)
if lat:
    n = len(lat)
    print(f'latency ms: min={lat[0]} p50={lat[n//2]} p90={lat[int(n*0.9)]} max={lat[-1]} mean={sum(lat)//n}')

sizes = {}
alpha_bad = []
for name, r in sorted(saved.items()):
    sizes[r['actual_size']] = sizes.get(r['actual_size'], 0) + 1
    if name and name.split('--')[0][0] in 'KC' and 'G' not in name.split('--')[0] and not r['has_alpha']:
        alpha_bad.append(name)
print('actual sizes:', sizes)
print('files saved:', len(saved), ' sprite-without-alpha:', alpha_bad or 'none')

for r in ref + err:
    e = r.get('err', {})
    print(f"  {r.get('kind')} {r.get('asset')}--{r.get('arm')} nr={r.get('nr')} status={e.get('status')} code={e.get('code')} {e.get('msg','')[:140]}")

usage = [r.get('usage', {}) for r in ok]
tot = sum(u.get('total_tokens', 0) for u in usage)
print(f'total tokens: {tot}')
missing = []
for a in [f'{p}{i}' for p in 'KC' for i in range(1, 9)] + ['G1', 'G2']:
    for arm in 'AB':
        if f'{a}--{arm}' not in saved and f'{a}--{arm}-nr' not in saved:
            missing.append(f'{a}--{arm}')
print('missing outputs:', missing or 'none')
