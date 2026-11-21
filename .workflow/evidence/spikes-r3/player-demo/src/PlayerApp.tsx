import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, StageSnap, emptySnap, STAGE_W, STAGE_H } from './stage';
import { compile, Step, Seg } from './compiler';

interface Reg { id: string; kind: string; file?: string; status: string }
type Ui = 'none' | 'backlog' | 'save' | 'load' | 'settings';

const q = new URLSearchParams(location.search);
const SCRIPT = q.get('script') ?? 'ch01.nvs';
const FONT_SIZE = +(q.get('fs') ?? 30);

/* per player.md:101 auto = 1.2s + 0.08s × chars; text speed ms/char slider 3~153, 0=瞬间 */
const AUTO_BASE = 1200, AUTO_PER_CHAR = 80, BACKLOG_CAP = 200;

export function PlayerApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(0);
  const [snap, setSnap] = useState<StageSnap>(emptySnap());
  const [ui, setUi] = useState<Ui>('none');
  const [auto, setAuto] = useState(false);
  const [skip, setSkip] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [charDelay, setCharDelay] = useState(26);
  const [backlog, setBacklog] = useState<StageSnap[]>([]);
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [typeTokens, setTypeTokens] = useState<{ seg: Seg; text: string }[]>([]);
  const [caption, setCaption] = useState<string | null>(null);
  const stateRef = useRef({ idx, snap, backlog });
  stateRef.current = { idx, snap, backlog };

  /* ---------- load script + registry ---------- */
  useEffect(() => {
    (async () => {
      const [reg, src] = await Promise.all([
        fetch('/assets/registry.json').then(r => r.json()) as Promise<Reg[]>,
        fetch('/scripts/' + SCRIPT).then(r => r.text()),
      ]);
      const files: Record<string, string> = {}, kinds: Record<string, string> = {}, nm: Record<string, string> = {};
      for (const r of reg) { if (r.file) files[r.id] = r.file; kinds[r.id] = r.kind; }
      // display names: derive from asset id last segment; Chinese name map for the 3 scripts' speakers
      const CN: Record<string, string> = { xiangzi: '祥子', 'rickshaw-shop-owner': '铺主', 'bald-rickshawman': '光头车夫', 'xiaoma-grandpa': '小马儿祖父', 'baimian-koudai': '白面口袋', 'gao-ma': '高妈' };
      Object.assign(nm, CN);
      const compiled = compile(src);
      const st = new Stage(files, kinds);
      await st.init(canvasRef.current!);
      stageRef.current = st;
      setNames(nm);
      setSteps(compiled);
      setReady(true);
      (window as unknown as { __player: unknown }).__player = api;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- step semantics ----------
   * A "line" step is a click point. Command steps attached before it run
   * together when the line becomes current (work-format.md:81: 写在一句话
   * 前面的指令和这句话同时生效). @wait is itself a click point with no text.
   */
  const groups = useMemo(() => {
    const out: { cmds: Step[]; line: Step | null }[] = [];
    let pending: Step[] = [];
    for (const s of steps) {
      if (s.kind === 'cmd' && s.cmd !== 'wait' && s.cmd !== 'caption') { pending.push(s); continue; }
      if (s.kind === 'cmd' && (s.cmd === 'wait' || s.cmd === 'caption')) {
        out.push({ cmds: pending, line: s }); pending = []; continue;
      }
      out.push({ cmds: pending, line: s }); pending = [];
    }
    if (pending.length) out.push({ cmds: pending, line: null });
    return out;
  }, [steps]);
  const [gidx, setGidx] = useState(0);
  const group = groups[gidx];

  /* flatten tokens of current line for the typewriter */
  const lineSegs: Seg[] = group?.line?.segs ?? [];
  const fullText = useMemo(() => lineSegs.map(s => s.text ?? '').join(''), [lineSegs]);
  const lineId = group?.line?.id ?? `g${gidx}`;
  const isCaptionStep = group?.line?.cmd === 'caption';
  const isWaitStep = group?.line?.cmd === 'wait';

  /* ---------- run group: apply cmds to stage + snapshot ---------- */
  const runGroup = useCallback(async (gi: number, { instant = false, record = true, replay = false } = {}) => {
    const st = stageRef.current;
    if (!st) return;
    const g = groups[gi];
    if (!g) return;
    const ns: StageSnap = JSON.parse(JSON.stringify(stateRef.current.snap)) as StageSnap;
    // apply commands to live stage and snapshot
    for (const c of g.cmds) {
      const a = c.args ?? [];
      const num = (v: string | undefined, d: number) => (v !== undefined && /^\d+(\.\d+)?$/.test(v) ? +v : d);
      switch (c.cmd) {
        case 'bg': ns.bg = a[0]; ns.cg = null; break;
        case 'show': ns.sprites[a[1] ?? 'center'] = { asset: a[0], slot: a[1] ?? 'center' }; break;
        case 'face': {
          const pfx = a[0].split('/')[0];
          for (const [slot, sp] of Object.entries(ns.sprites)) if (sp.asset.split('/')[0] === pfx) ns.sprites[slot] = { asset: a[0], slot };
          break;
        }
        case 'hide': {
          const t = a[0];
          if (['left', 'center', 'right', 'far-left', 'far-right'].includes(t)) delete ns.sprites[t];
          else for (const [slot, sp] of Object.entries(ns.sprites)) if (sp.asset === t || sp.asset.startsWith(t + '/')) delete ns.sprites[slot];
          break;
        }
        case 'cg': ns.cg = a[0] ?? null; break;
        case 'zoom': { const nums = a.filter(x => /^\d/.test(x)); ns.camera.zoom = num(nums[0], 1); break; }
        case 'camera': if (a[0] === 'push-in') ns.camera.zoom = 1.12; break;
        case 'particle': { const inten = num(a[1], 0.5); ns.particle = inten <= 0 ? null : { name: a[0], intensity: inten }; break; }
        case 'filter': ns.filter = a[0] === 'none' ? null : { name: a[0], value: num(a[1], 1) }; break;
        default: break;
      }
    }
    if (g.line?.cmd === 'caption') { ns.caption = g.line.text ?? null; setCaption(ns.caption); }
    else if (g.line && g.line.kind === 'line') {
      setCaption(null);
      ns.caption = null;
      ns.text = { speaker: g.line.speaker, display: g.line.alias ?? (g.line.speaker ? names[g.line.speaker] ?? g.line.speaker : null), kind: g.line.inner ? 'inner' : g.line.speaker ? 'dialogue' : 'narration', text: (g.line.segs ?? []).map(s => s.text ?? '').join('') };
    }
    if (g.line?.cmd === 'wait') ns.caption = null;
    ns.step = gi;
    if (!replay) {
      // live path: animate toward snapshot
      for (const c of g.cmds) await st.run(c, instant);
      st.tagAssets(ns);
    } else {
      // rollback/jump path: full restore (per player.md:97 — idempotent state writes rerun)
      await st.restore(ns);
      st.tagAssets(ns);
      setCaption(ns.caption);
    }
    setSnap(ns);
    setGidx(gi);
    setShown(0);
    if (record && g.line?.kind === 'line') {
      setBacklog(b => [...b.filter(e => e.step < gi), ns].slice(-BACKLOG_CAP));
      if (g.line.id) setReadSet(s => new Set(s).add(g.line!.id!));
    }
  }, [groups, names]);

  /* start at group 0 once loaded */
  useEffect(() => { if (ready && groups.length && gidx === 0 && snap.step < 0) void runGroup(0); }, [ready, groups, gidx, snap.step, runGroup]);

  /* ---------- typewriter ---------- */
  const tokens = useMemo(() => {
    // tokens = per-grapheme slices of the segs (Intl.Segmenter for CJK clusters)
    const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
    const out: { seg: Seg; text: string }[] = [];
    for (const s of lineSegs) {
      if (s.wait !== undefined) { out.push({ seg: s, text: '' }); continue; }
      for (const g of seg.segment(s.text ?? '')) out.push({ seg: s, text: g.segment });
    }
    return out;
  }, [lineSegs]);
  useEffect(() => setTypeTokens(tokens), [tokens]);
  const textDone = shown >= tokens.length;

  useEffect(() => {
    if (!group?.line || group.line.kind !== 'line' || textDone || ui !== 'none' || hidden) return;
    if (charDelay === 0) { setShown(tokens.length); return; }
    const t = tokens[shown];
    const base = t?.seg.wait !== undefined ? t.seg.wait * 1000 : charDelay * (t?.seg.speed ?? 1);
    const timer = window.setTimeout(() => setShown(v => v + 1), skip ? 0 : base);
    return () => window.clearTimeout(timer);
  }, [shown, tokens, textDone, charDelay, ui, hidden, group, skip]);

  /* ---------- advance ---------- */
  const advance = useCallback(() => {
    if (ui !== 'none' || hidden || !group) return;
    const l = group.line;
    if (l?.kind === 'line' && !textDone) { setShown(tokens.length); return; } // click completes line
    if (gidx < groups.length - 1) void runGroup(gidx + 1, { instant: skip });
    else {
      // end of script: loop back for demo
      void runGroup(0, { replay: true });
      setBacklog([]);
    }
  }, [ui, hidden, group, textDone, tokens.length, gidx, groups.length, runGroup, skip]);
  const advanceRef = useRef(advance); advanceRef.current = advance;

  /* auto + skip-read timers (player.md:99-101) */
  useEffect(() => {
    if (!ready || ui !== 'none' || hidden || !group?.line) return;
    if (group.line.kind !== 'line' && group.line.cmd !== 'wait' && !(group.line.cmd === 'caption' && group.line.captionWait)) return;
    if (!textDone) return;
    if (skip) {
      if (group.line.kind === 'line' && group.line.id && !readSet.has(group.line.id)) { setSkip(false); return; }
      const t = window.setTimeout(() => advanceRef.current(), 50);
      return () => window.clearTimeout(t);
    }
    if (auto) {
      const delay = AUTO_BASE + AUTO_PER_CHAR * fullText.length;
      const t = window.setTimeout(() => advanceRef.current(), delay);
      return () => window.clearTimeout(t);
    }
  }, [ready, ui, hidden, group, textDone, skip, auto, readSet, fullText]);

  /* @wait: with seconds arg it's a timed pause; bare @wait waits for click (work-format.md:82) */
  useEffect(() => {
    if (!isWaitStep || ui !== 'none') return;
    const arg = group?.line?.args?.[0];
    if (arg === undefined) return; // waits for click
    const t = window.setTimeout(() => advanceRef.current(), (+arg || 0.6) * 1000);
    return () => window.clearTimeout(t);
  }, [isWaitStep, gidx, ui, group]);

  /* caption without wait: display then auto-advance after duration */
  useEffect(() => {
    if (!isCaptionStep || group?.line?.captionWait || ui !== 'none') return;
    const t = window.setTimeout(() => advanceRef.current(), (group?.line?.captionDur ?? 1.2) * 1000);
    return () => window.clearTimeout(t);
  }, [isCaptionStep, gidx, ui, group]);

  /* ---------- save / load ---------- */
  const SAVE_KEY = 'nldemo-save-' + SCRIPT;
  const save = () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ snap, gidx, backlog, read: [...readSet], at: Date.now() }));
  };
  const load = async () => {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw) as { snap: StageSnap; gidx: number; backlog: StageSnap[]; read: string[] };
    const st = stageRef.current!;
    await st.restore(s.snap);
    st.tagAssets(s.snap);
    setSnap(s.snap); setGidx(s.gidx); setBacklog(s.backlog); setReadSet(new Set(s.read));
    setShown(Number.MAX_SAFE_INTEGER); // restored line shows complete
    setCaption(s.snap.caption);
    setUi('none');
    return true;
  };

  const jumpBack = async (bi: number) => {
    const target = backlog[bi];
    if (!target) return;
    setUi('none');
    await runGroup(target.step, { replay: true, record: false });
    setShown(Number.MAX_SAFE_INTEGER);
    // mark every passed line read (player.md:99)
    setReadSet(prev => { const n = new Set(prev); for (const g of groups.slice(0, target.step + 1)) if (g.line?.id) n.add(g.line.id); return n; });
  };

  /* ---------- debug / measurement API ---------- */
  const api = useMemo(() => ({
    goto: (gi: number) => runGroup(gi),
    advance: () => advanceRef.current(),
    state: () => stateRef.current,
    measureSnapshot: () => JSON.stringify(stateRef.current.snap).length,
    restoreTime: async () => {
      const s = JSON.parse(JSON.stringify(stateRef.current.snap)) as StageSnap;
      const t0 = performance.now();
      await stageRef.current!.restore(s);
      return performance.now() - t0;
    },
    textDone,
    groupCount: groups.length,
    completeLine: () => setShown(tokens.length),
    backlog,
    save, load,
    setCharDelay,
    stage: () => stageRef.current,
  }), [backlog, runGroup, groups.length, textDone, tokens.length]);
  useEffect(() => { (window as unknown as { __player?: unknown }).__player = api; }, [api]);

  /* ---------- render ---------- */
  const line = group?.line;
  const speakerName = line?.kind === 'line' ? (line.alias ?? (line.speaker ? names[line.speaker] ?? line.speaker : null)) : null;
  const isInner = line?.inner === true;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}
      onClick={() => { if (hidden) { setHidden(false); return; } if (ui === 'none') advanceRef.current(); }}
      onContextMenu={e => { e.preventDefault(); setUi(u => u === 'none' ? 'settings' : 'none'); }}>
      {/* 16:9 stage, cover-fit, no letterbox (player.md:19-20) */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'max(100vw, 177.78vh)', height: 'max(100vh, 56.25vw)' }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        {caption && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, pointerEvents: 'none' }}>
            <div style={{ color: '#eef2f6', fontSize: 44, letterSpacing: '0.24em', fontWeight: 600, fontFamily: '"Noto Serif SC", serif', textShadow: '0 2px 22px rgba(0,0,0,.7)' }}>{caption}</div>
            <div style={{ width: 96, height: 1, background: 'linear-gradient(90deg,transparent,#ffffff88,transparent)' }} />
          </div>
        )}
      </div>

      {/* text box — DOM overlay (player.md:53) */}
      {!hidden && !isCaptionStep && line?.kind === 'line' && (
        <div style={{ position: 'absolute', left: '50%', bottom: '3.2%', transform: 'translateX(-50%)', width: 'min(78%, 1500px)', zIndex: 40 }}>
          {speakerName && (
            <div style={{ display: 'inline-block', padding: '4px 18px', marginBottom: -1, borderRadius: '10px 10px 0 0', background: 'rgba(16,20,26,.82)', border: '1px solid rgba(255,255,255,.12)', borderBottom: 'none', color: isInner ? '#a8c8e8' : '#ffd98a', fontSize: FONT_SIZE * 0.62, fontFamily: '"Noto Sans SC",sans-serif', letterSpacing: '0.12em' }}>
              {speakerName}{isInner ? '（内心）' : ''}
            </div>
          )}
          <div className="vn-text" data-testid="textbox" style={{
            position: 'relative', borderRadius: speakerName ? '0 14px 14px 14px' : 14,
            background: 'linear-gradient(170deg, rgba(18,24,32,.78), rgba(10,14,19,.86))',
            border: '1px solid rgba(255,255,255,.13)', backdropFilter: 'blur(10px)',
            padding: `${FONT_SIZE * 0.75}px ${FONT_SIZE * 1.1}px`, minHeight: FONT_SIZE * 2.9,
            color: '#e9edf2', fontSize: FONT_SIZE, lineHeight: 1.62,
            fontFamily: '"Noto Serif SC","Noto Sans SC",serif',
          }}>
            {/* ghost layer keeps layout; visible layer reveals per char (no reflow) */}
            <div className="ghost" aria-hidden style={{ position: 'absolute', inset: `${FONT_SIZE * 0.75}px ${FONT_SIZE * 1.1}px`, fontSize: FONT_SIZE, lineHeight: 1.62 }}>
              {lineSegs.map((s, i) => s.wait !== undefined ? null : s.ruby
                ? <ruby key={i}>{s.text}<rt>{s.ruby}</rt></ruby>
                : <span key={i} className={s.marks?.map(m => `mark-${m}`).join(' ')}>{s.text}</span>)}
            </div>
            <div style={{ position: 'relative' }}>
              {typeTokens.slice(0, shown).map((t, i) =>
                t.seg.wait !== undefined ? null :
                t.seg.ruby
                  ? <ruby key={i} style={{ rubyPosition: 'over' }}>{t.text}<rt>{t.seg.ruby}</rt></ruby>
                  : <span key={i} className={t.seg.marks?.map(m => `mark-${m}`).join(' ')}>{t.text}</span>)}
              {textDone && <span style={{ marginLeft: 8, color: '#ffd98a', fontSize: FONT_SIZE * 0.6 }}>▼</span>}
            </div>
          </div>
          {/* quick buttons bottom-right of text box (DESIGN.md:28-29) */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }} onClick={e => e.stopPropagation()}>
            <button className="qbtn" data-act="save" onClick={save}>存档</button>
            <button className="qbtn" data-act="load" onClick={load}>读档</button>
            <button className={`qbtn${auto ? ' on' : ''}`} data-act="auto" onClick={() => { setAuto(v => !v); setSkip(false); }}>自动</button>
            <button className={`qbtn${skip ? ' on' : ''}`} data-act="skip" onClick={() => { setSkip(v => !v); setAuto(false); }}>跳过</button>
            <button className="qbtn" data-act="backlog" onClick={() => setUi('backlog')}>记录</button>
            <button className="qbtn" data-act="hide" onClick={() => setHidden(true)}>隐藏</button>
            <button className="qbtn" data-act="settings" onClick={() => setUi('settings')}>设置</button>
          </div>
        </div>
      )}

      {/* backlog */}
      {ui === 'backlog' && (
        <div className="screen" onClick={e => e.stopPropagation()}>
          <h2 style={{ fontWeight: 600, letterSpacing: '.2em' }}>记录（{backlog.length} / {BACKLOG_CAP}）</h2>
          {backlog.map((b, i) => (
            <div key={i} className="backlog-item" onClick={() => void jumpBack(i)}>
              <span style={{ color: '#ffd98a', marginRight: 10 }}>{b.text?.display ?? (b.text?.kind === 'narration' ? '旁白' : '')}</span>
              <span>{b.text?.text?.slice(0, 60)}{(b.text?.text?.length ?? 0) > 60 ? '…' : ''}</span>
              <span style={{ float: 'right', color: '#8892a0', fontSize: 12 }}>句 {b.step + 1}</span>
            </div>
          ))}
          <button className="qbtn" style={{ marginTop: 16 }} onClick={() => setUi('none')}>关闭</button>
        </div>
      )}

      {/* settings */}
      {ui === 'settings' && (
        <div className="screen" onClick={e => e.stopPropagation()}>
          <h2 style={{ fontWeight: 600, letterSpacing: '.2em' }}>设置</h2>
          <label style={{ display: 'block', margin: '18px 0' }}>
            文字速度（毫秒/字，0=瞬间）：{charDelay}
            <input type="range" min={0} max={153} value={charDelay} onChange={e => setCharDelay(+e.target.value)} style={{ width: 320, display: 'block', marginTop: 8 }} />
          </label>
          <button className="qbtn" data-act="save" onClick={save}>存档到 localStorage</button>{' '}
          <button className="qbtn" data-act="load" onClick={load}>读取</button>{' '}
          <button className="qbtn" onClick={() => setUi('none')}>关闭</button>
        </div>
      )}
    </div>
  );
}
