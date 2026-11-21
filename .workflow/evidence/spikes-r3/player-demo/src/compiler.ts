/* Browser-side .nvs compiler — same grammar as tools/compile.mjs.
 * Returns steps[] where each step is a command or a text line; the player
 * executes commands as they arrive at a text step's position and waits for
 * click on text steps. Steps get a global flat index across scenes.
 */
export interface Seg { text?: string; marks?: string[]; ruby?: string; speed?: number; wait?: number }
export interface Step {
  idx: number; scene: string; line: number;
  kind: 'cmd' | 'line';
  cmd?: string; args?: string[]; text?: string; captionWait?: boolean; captionDur?: number;
  speaker?: string | null; alias?: string | null; inner?: boolean;
  segs?: Seg[]; id?: string | null; cont?: boolean;
}

const COMMANDS = new Set('bg fg show hide move face costume cg camera shake zoom particle mask filter caption wait'.split(' '));
const SPEAKER_RE = /^(?<asset>[a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\s*\((?<paren>[^)]*)\))?(?:\s+as\s+(?<alias>.+?))?\s*:\s*(?<text>.*)$/;
const ID_RE = /\s#([0-9a-f]{4})$/;

function parseInline(text: string): Seg[] {
  const segs: Seg[] = [];
  const stack: (string | { name: string; arg: string | number })[] = [];
  const marks = () => stack.filter((s): s is string => typeof s === 'string');
  const speedMul = () => stack.reduce((a, t) => a * (typeof t === 'object' && t.name === 'speed' ? (t.arg as number) : 1), 1);
  const rubyOf = () => { const r = stack.find(t => typeof t === 'object' && t.name === 'ruby'); return r ? (r as any).arg as string : undefined; };
  let buf = '', i = 0;
  const pushBuf = () => { if (!buf) return; segs.push({ text: buf, marks: marks(), ruby: rubyOf(), speed: speedMul() }); buf = ''; };
  while (i < text.length) {
    const c = text[i];
    if (c === '{') {
      if (text[i + 1] === '{') { buf += '{'; i += 2; continue; }
      const m = /^\{(\/[a-zA-Z][a-zA-Z0-9-]*|[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^}]*)?)\}/.exec(text.slice(i));
      if (!m) { buf += c; i += 1; continue; }
      const inner = m[1]; i += m[0].length;
      if (inner.startsWith('/')) {
        const name = inner.slice(1);
        const idx = stack.map(t => (typeof t === 'object' ? t.name : t)).lastIndexOf(name);
        if (idx >= 0) stack.splice(idx, 1);
        continue;
      }
      const sp = inner.indexOf(' ');
      const name = (sp < 0 ? inner : inner.slice(0, sp)).trim();
      const arg = sp < 0 ? '' : inner.slice(sp + 1).trim();
      if (name === 'wait') { pushBuf(); segs.push({ wait: parseFloat(arg) || 0 }); continue; }
      pushBuf();
      if (name === 'ruby') stack.push({ name, arg });
      else if (name === 'speed') stack.push({ name, arg: parseFloat(arg) || 1 });
      else stack.push(name);
      continue;
    }
    buf += c; i += 1;
  }
  pushBuf();
  return segs;
}

let autoId = 0;
export function compile(src: string): Step[] {
  const steps: Step[] = [];
  let scene = '';
  for (const [li, raw] of src.split('\n').entries()) {
    const line = raw.replace(/\s+$/, '');
    const lineno = li + 1;
    if (!line.trim()) continue;
    if (line.startsWith('scene ')) { scene = line.slice(6).trim(); continue; }
    if (line.startsWith('source ')) continue;
    if (line.startsWith('@')) {
      const sp = line.indexOf(' ');
      const cmd = sp < 0 ? line.slice(1) : line.slice(1, sp);
      const argstr = sp < 0 ? '' : line.slice(sp + 1).trim();
      if (!COMMANDS.has(cmd)) continue;
      const step: Step = { idx: steps.length, scene, line: lineno, kind: 'cmd', cmd };
      if (cmd === 'caption') {
        const wait = /\bwait$/.test(argstr);
        let text = (wait ? argstr.replace(/\bwait$/, '') : argstr).trim();
        const dm = /^(.*?)\s+(\d+(?:\.\d+)?)$/.exec(text);
        if (dm) { text = dm[1]; step.captionDur = +dm[2]; }
        step.text = text; step.captionWait = wait;
      } else {
        step.args = argstr ? argstr.split(/\s+/) : [];
      }
      steps.push(step);
      continue;
    }
    let speaker: string | null = null, alias: string | null = null, inner = false, textpart: string;
    if (line.startsWith(': ')) { textpart = line.slice(2); }
    else {
      const m = SPEAKER_RE.exec(line);
      if (!m) continue;
      speaker = m.groups!.asset!;
      alias = m.groups!.alias || null;
      if (m.groups!.paren) inner = m.groups!.paren.split(/\s+/).includes('inner');
      textpart = m.groups!.text!;
    }
    let id: string | null = null, cont = false;
    const idm = ID_RE.exec(textpart);
    if (idm) { id = idm[1]; textpart = textpart.slice(0, idm.index); }
    if (/(\s|^)cont\s*$/.test(textpart)) { cont = true; textpart = textpart.replace(/(\s|^)cont\s*$/, ''); }
    const text = textpart.trim();
    steps.push({ idx: steps.length, scene, line: lineno, kind: 'line', speaker, alias, inner, text, segs: parseInline(text), id: id ?? `auto-${(autoId++).toString(16).padStart(4, '0')}`, cont });
  }
  return steps;
}
