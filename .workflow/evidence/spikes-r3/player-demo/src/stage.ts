/* Imperative PixiJS 8 stage. Logic state is a pure-JSON snapshot (per
 * player.md:11); this class renders a snapshot and animates toward it.
 * Snapshot fields per player.md:82-95:
 *   bg, sprites{slot→{asset,x,y,scale,z}}, cg, camera{zoom,focus}, shake,
 *   particle, filter, text(speaker/kind), progress(step).
 * Everything idempotent: restore(snapshot) must reproduce the exact stage.
 */
import { Application, Assets, Container, Sprite, Texture, BlurFilter, ColorMatrixFilter, Graphics } from 'pixi.js';
import { AdjustmentFilter, GlitchFilter } from 'pixi-filters';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export interface SpriteState { asset: string; slot: string }
export interface StageSnap {
  bg: string | null;
  sprites: Record<string, SpriteState>;
  cg: string | null;
  camera: { zoom: number; focus: string; sway: boolean };
  particle: { name: string; intensity: number } | null;
  filter: { name: string; value: number } | null;
  caption: string | null;
  text: { speaker: string | null; display: string | null; kind: string; text: string } | null;
  step: number;
  activePerforms: string[];
}

export const emptySnap = (): StageSnap => ({
  bg: null, sprites: {}, cg: null,
  camera: { zoom: 1, focus: 'center', sway: false },
  particle: null, filter: null, caption: null, text: null, step: -1,
  activePerforms: [],
});

const SLOT_X: Record<string, number> = { 'far-left': 0.12, left: 0.26, center: 0.5, right: 0.74, 'far-right': 0.88 };

const easeFn: Record<string, (t: number) => number> = {
  linear: t => t,
  ease: t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  'ease-in': t => t * t,
  'ease-out': t => 1 - (1 - t) * (1 - t),
  'ease-in-out': t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
};

interface Tween { obj: any; props: Record<string, { from: number; to: number }>; t: number; dur: number; ease: (t: number) => number; done: () => void }

export class Stage {
  app!: Application;
  root!: Container;         // camera transform applies here
  bgLayer!: Container;
  spriteLayer!: Container;
  cgLayer!: Container;
  particleLayer!: Container;
  dimOverlay!: Graphics;
  tweens: Tween[] = [];
  sprites = new Map<string, { cur: Sprite; prev: Sprite | null }>();
  bgSprites: { cur: Sprite | null; prev: Sprite | null } = { cur: null, prev: null };
  cgSprite: Sprite | null = null;
  rain: { g: Graphics; drops: { x: number; y: number; v: number }[] } | null = null;
  shakeUntil = 0;
  swayT = 0;
  files: Record<string, string>;
  kinds: Record<string, string>;
  texCache = new Map<string, Promise<Texture>>();
  onPerformEnd?: () => void;
  activePerforms = new Set<string>();

  constructor(files: Record<string, string>, kinds: Record<string, string>) {
    this.files = files; this.kinds = kinds;
  }

  async init(canvas: HTMLCanvasElement) {
    const app = new Application();
    await app.init({ canvas, width: STAGE_W, height: STAGE_H, background: 0x000000, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    this.app = app;
    this.root = new Container();
    this.root.pivot.set(STAGE_W / 2, STAGE_H / 2);
    this.root.position.set(STAGE_W / 2, STAGE_H / 2);
    this.bgLayer = new Container();
    this.spriteLayer = new Container();
    this.cgLayer = new Container();
    this.particleLayer = new Container();
    this.dimOverlay = new Graphics().rect(0, 0, STAGE_W, STAGE_H).fill(0x000000);
    this.dimOverlay.alpha = 0;
    this.root.addChild(this.bgLayer, this.spriteLayer, this.cgLayer, this.particleLayer, this.dimOverlay);
    app.stage.addChild(this.root);
    app.ticker.add((tk) => this.tick(tk.deltaMS));
    return app;
  }

  texture(asset: string): Promise<Texture> {
    let p = this.texCache.get(asset);
    if (!p) {
      const file = this.files[asset];
      p = file ? Assets.load<Texture>('/assets/' + file) : Promise.resolve(Texture.WHITE);
      this.texCache.set(asset, p);
    }
    return p;
  }

  private fitBg(s: Sprite, tex: Texture) {
    const scale = Math.max(STAGE_W / tex.width, STAGE_H / tex.height);
    s.scale.set(scale);
    s.anchor.set(0.5);
    s.position.set(STAGE_W / 2, STAGE_H / 2);
  }

  private fitSprite(s: Sprite, tex: Texture, slot: string) {
    // sprite: bottom-anchored at slot x; height 82% of stage (2048x3072 → h≈886→w≈591)
    const h = STAGE_H * 0.82;
    const scale = h / tex.height;
    s.scale.set(scale);
    s.anchor.set(0.5, 1);
    s.position.set(STAGE_W * (SLOT_X[slot] ?? 0.5), STAGE_H + 8);
  }

  private tween(obj: any, props: Record<string, number>, dur: number, ease: (t: number) => number = easeFn.ease, done = () => {}) {
    const p: Tween['props'] = {};
    for (const [k, to] of Object.entries(props)) p[k] = { from: obj[k] as number, to };
    this.tweens.push({ obj, props: p, t: 0, dur: Math.max(dur, 1), ease, done });
  }

  private tweenAll(targets: { obj: any; props: Record<string, number> }[], dur: number, ease = easeFn.ease) {
    return new Promise<void>((res) => {
      if (dur <= 0) { for (const t of targets) for (const [k, v] of Object.entries(t.props)) t.obj[k] = v; res(); return; }
      let left = targets.length;
      for (const t of targets) this.tween(t.obj, t.props, dur, ease, () => { if (--left === 0) res(); });
    });
  }

  tick(ms: number) {
    const done: Tween[] = [];
    for (const tw of this.tweens) {
      tw.t += ms;
      const k = Math.min(tw.t / tw.dur, 1);
      const e = tw.ease(k);
      for (const [prop, r] of Object.entries(tw.props)) tw.obj[prop] = r.from + (r.to - r.from) * e;
      if (k >= 1) done.push(tw);
    }
    for (const tw of done) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.done(); }
    // rain
    if (this.rain) {
      const { g, drops } = this.rain;
      g.clear().setStrokeStyle({ width: 1.4, color: 0xa8bdd4, alpha: 0.45 });
      for (const d of drops) {
        d.y += d.v * ms; d.x += d.v * ms * 0.14;
        if (d.y > STAGE_H) { d.y = -20; d.x = Math.random() * STAGE_W; }
        if (d.x > STAGE_W + 40) d.x -= STAGE_W + 40;
        g.moveTo(d.x, d.y).lineTo(d.x - 6, d.y - 26).stroke();
      }
    }
    // camera sway (hold-on perform)
    if (this.swayT > 0) {
      this.swayT += ms;
      const s = Math.sin(this.swayT / 900) * 6;
      this.root.x = STAGE_W / 2 + s;
    }
    // shake impulse
    if (this.shakeUntil > 0) {
      const left = this.shakeUntil - performance.now();
      if (left <= 0) { this.shakeUntil = 0; this.root.position.set(STAGE_W / 2, STAGE_H / 2); this.root.rotation = 0; }
      else {
        const a = Math.min(left / 120, 1) * 14;
        this.root.x = STAGE_W / 2 + (Math.random() - .5) * a;
        this.root.y = STAGE_H / 2 + (Math.random() - .5) * a;
        this.root.rotation = (Math.random() - .5) * 0.004;
      }
    }
  }

  /* ---- commands ---- */

  async setBg(asset: string | null, transition = 'fade', dur = 1.0) {
    if (!asset) {
      if (this.bgSprites.cur) { const old = this.bgSprites.cur; this.bgSprites.cur = null; await this.tweenAll([{ obj: old, props: { alpha: 0 } }], dur * 1000); old.destroy(); }
      return;
    }
    const tex = await this.texture(asset);
    const s = new Sprite(tex);
    this.fitBg(s, tex);
    if (transition === 'none' || !this.bgSprites.cur) {
      const old = this.bgSprites.cur;
      s.alpha = transition === 'none' ? 1 : 1;
      this.bgLayer.addChild(s);
      if (old && transition === 'none') old.destroy();
      else if (old) await this.tweenAll([{ obj: old, props: { alpha: 0 } }], dur * 1000).then(() => old.destroy());
      this.bgSprites.cur = s;
      return;
    }
    const old = this.bgSprites.cur!;
    if (transition === 'fade') {
      // fade through black per work-format.md:72
      this.bgLayer.addChildAt(s, 0);
      s.alpha = 1;
      await this.tweenAll([{ obj: this.dimOverlay, props: { alpha: 1 } }], dur * 500);
      old.destroy();
      this.bgLayer.removeChild(s); this.bgLayer.addChildAt(s, 0);
      await this.tweenAll([{ obj: this.dimOverlay, props: { alpha: 0 } }], dur * 500);
    } else if (transition === 'dissolve' || transition.startsWith('wipe') || transition === 'slide' || transition === 'push' || transition === 'zoom') {
      // dissolve = cross-fade; wipe/slide/push approximated by cross-fade + slight motion (documented gap)
      s.alpha = 0;
      this.bgLayer.addChild(s);
      if (transition === 'slide' || transition === 'push') { s.x = STAGE_W / 2 + 60; this.tween(s, { x: STAGE_W / 2 }, dur * 1000); }
      if (transition === 'zoom') { const sc = s.scale.x; s.scale.set(sc * 1.06); this.tween(s.scale, { x: sc, y: sc }, dur * 1000); }
      await this.tweenAll([{ obj: s, props: { alpha: 1 } }, { obj: old, props: { alpha: 0 } }], dur * 1000);
      old.destroy();
    } else {
      s.alpha = 0; this.bgLayer.addChild(s);
      await this.tweenAll([{ obj: s, props: { alpha: 1 } }, { obj: old, props: { alpha: 0 } }], dur * 1000);
      old.destroy();
    }
    this.bgSprites.cur = s;
  }

  async showSprite(asset: string, slot: string, instant = false) {
    const tex = await this.texture(asset);
    const cur = this.sprites.get(slot);
    if (cur) {
      const sameSize = cur.cur.texture.width === tex.width && cur.cur.texture.height === tex.height;
      const old = cur.cur;
      const s = new Sprite(tex);
      this.fitSprite(s, tex, slot);
      s.alpha = 0;
      this.spriteLayer.addChild(s);
      cur.cur = s;
      if (sameSize) {
        // same-size expression swap: 200ms crossfade, no positional jump (player.md:26)
        const d = instant ? 1 : 200;
        await this.tweenAll([{ obj: s, props: { alpha: 1 } }, { obj: old, props: { alpha: 0 } }], d);
      } else {
        const d = instant ? 1 : 300;
        await this.tweenAll([{ obj: old, props: { alpha: 0 } }], d / 2);
        await this.tweenAll([{ obj: s, props: { alpha: 1 } }], d / 2);
      }
      old.destroy();
      return;
    }
    const s = new Sprite(tex);
    this.fitSprite(s, tex, slot);
    s.alpha = 0;
    this.spriteLayer.addChild(s);
    this.sprites.set(slot, { cur: s, prev: null });
    await this.tweenAll([{ obj: s, props: { alpha: 1 } }], instant ? 1 : 300);
  }

  async hideSprite(slot: string, instant = false) {
    const cur = this.sprites.get(slot);
    if (!cur) return;
    this.sprites.delete(slot);

    await this.tweenAll([{ obj: cur.cur, props: { alpha: 0 } }], instant ? 1 : 300);
    cur.cur.destroy();
  }

  async hideByAsset(assetPrefix: string, instant = false) {
    for (const [slot, s] of [...this.sprites]) {
      if (this.assetOf(s.cur) === assetPrefix || this.assetOf(s.cur)?.startsWith(assetPrefix + '/'))
        await this.hideSprite(slot, instant);
    }
  }

  private assetOf(s: Sprite): string | null { return (s as any).__asset ?? null; }

  async setCg(asset: string | null) {
    if (asset) {
      const tex = await this.texture(asset);
      const s = new Sprite(tex);
      this.fitBg(s, tex);
      (s as any).__asset = asset;
      s.alpha = 0;
      this.cgLayer.addChild(s);
      const old = this.cgSprite;
      this.cgSprite = s;
      await this.tweenAll([{ obj: s, props: { alpha: 1 } }, ...(old ? [{ obj: old, props: { alpha: 0 } }] : [])], 400);
      old?.destroy();
    } else if (this.cgSprite) {
      const old = this.cgSprite; this.cgSprite = null;
      await this.tweenAll([{ obj: old, props: { alpha: 0 } }], 300);
      old.destroy();
    }
  }

  setParticle(name: string | null, intensity = 0.5) {
    this.particleLayer.removeChildren().forEach(c => c.destroy());
    this.rain = null;
    if (!name || name === 'none' || intensity <= 0) return;
    if (name === 'rain') {
      const g = new Graphics();
      this.particleLayer.addChild(g);
      const n = Math.round(80 + intensity * 140);
      const drops = Array.from({ length: n }, () => ({ x: Math.random() * STAGE_W, y: Math.random() * STAGE_H, v: 0.9 + Math.random() * 0.5 }));
      this.rain = { g, drops };
    }
    // snow/sakura: not used by the 4 scripts — stub (listed in report)
  }

  setFilter(name: string | null, value = 1) {
    if (!name || name === 'none') { this.root.filters = []; return; }
    if (name === 'sepia') { const f = new ColorMatrixFilter(); f.sepia(false); f.alpha = value; this.root.filters = [f]; }
    else if (name === 'brightness') { this.root.filters = [new AdjustmentFilter({ brightness: value })]; }
    else if (name === 'blur') { this.root.filters = [new BlurFilter({ strength: 6 * value })]; }
    else if (name === 'glitch') { this.root.filters = [new GlitchFilter({ slices: 6, offset: 12 })]; }
  }

  async zoomTo(scale: number, dur = 1.0, ease = 'ease-out', instant = false) {
    this.activePerforms.add('zoom');
    if (instant) { this.root.scale.set(scale); this.activePerforms.delete('zoom'); return; }
    this.tween(this.root.scale, { x: scale, y: scale }, dur * 1000, easeFn[ease] ?? easeFn.ease, () => this.activePerforms.delete('zoom'));
  }

  cameraAction(action: string, _easing?: string, dur = 0.6) {
    if (action === 'sway') { this.swayT = 1; this.activePerforms.add('camera-sway'); setTimeout(() => { this.swayT = 0; this.root.x = STAGE_W / 2; this.activePerforms.delete('camera-sway'); }, dur * 4000); }
    else if (action === 'push-in') this.zoomTo(1.12, dur, 'ease-in');
  }

  shake(strength = 0.5, dur = 0.5) {
    const s = strength === 0 || /strong/i.test(String(strength)) ? 1 : +strength || 0.5;
    this.shakeUntil = performance.now() + dur * 1000;
    this.shakeAmp = 14 * s;
  }
  shakeAmp = 14;

  /* mark sprites so hideByAsset works */
  tagAssets(snap: StageSnap) {
    for (const [slot, st] of Object.entries(snap.sprites)) {
      const sp = this.sprites.get(slot);
      if (sp) (sp.cur as any).__asset = st.asset;
    }
  }

  /* instant restore — save/load and rollback path */
  async restore(snap: StageSnap) {
    this.tweens.length = 0;
    this.dimOverlay.alpha = 0;
    this.swayT = 0;
    // bg
    this.bgLayer.removeChildren().forEach(c => c.destroy());
    this.bgSprites.cur = null;
    if (snap.bg) {
      const tex = await this.texture(snap.bg);
      const s = new Sprite(tex); this.fitBg(s, tex); (s as any).__asset = snap.bg;
      this.bgLayer.addChild(s); this.bgSprites.cur = s;
    }
    // sprites
    for (const s of this.sprites.values()) s.cur.destroy();
    this.sprites.clear();
    for (const [slot, st] of Object.entries(snap.sprites)) {
      const tex = await this.texture(st.asset);
      const s = new Sprite(tex); this.fitSprite(s, tex, slot); (s as any).__asset = st.asset;
      this.spriteLayer.addChild(s); this.sprites.set(slot, { cur: s, prev: null });
    }
    // cg
    if (this.cgSprite) { this.cgSprite.destroy(); this.cgSprite = null; }
    if (snap.cg) {
      const tex = await this.texture(snap.cg);
      const s = new Sprite(tex); this.fitBg(s, tex); (s as any).__asset = snap.cg;
      this.cgLayer.addChild(s); this.cgSprite = s;
    }
    // camera
    this.root.scale.set(snap.camera.zoom);
    this.root.position.set(STAGE_W / 2, STAGE_H / 2);
    this.root.rotation = 0;
    this.shakeUntil = 0;
    this.setParticle(snap.particle?.name ?? null, snap.particle?.intensity ?? 0);
    this.setFilter(snap.filter?.name ?? null, snap.filter?.value ?? 1);
    this.activePerforms = new Set(snap.activePerforms.filter(p => !['shake', 'zoom'].includes(p)));
  }

  /* run a compiled command step against the live stage; instant for skip/restore */
  async run(step: any, instant = false) {
    const a: string[] = step.args ?? [];
    const num = (v: string | undefined, d: number) => (v !== undefined && /^\d+(\.\d+)?$/.test(v) ? +v : d);
    switch (step.cmd) {
      case 'bg': await this.setBg(a[0] ?? null, a[1] ?? 'fade', num(a[2], 1.0)); await this.setCg(null); break;
      case 'show': { const slot = a[1] ?? 'center'; await this.showSprite(a[0], slot, instant); break; }
      case 'face': { // same-slot expression swap; find which slot holds this character
        const charPrefix = a[0].split('/')[0];
        for (const [slot, sp] of this.sprites) {
          const cur = (sp.cur as any).__asset as string | undefined;
          if (cur && cur.split('/')[0] === charPrefix) { await this.showSprite(a[0], slot, instant); break; }
        }
        break;
      }
      case 'hide': {
        const t = a[0];
        if (['left', 'center', 'right', 'far-left', 'far-right'].includes(t)) await this.hideSprite(t, instant);
        else await this.hideByAsset(t, instant);
        break;
      }
      case 'cg': {
        if (a[0]) { await this.setCg(a[0]); if (!instant) { /* cg stays until next bg/cg */ } }
        else await this.setCg(null);
        break;
      }
      case 'zoom': {
        // grammar gap: two arg orders observed (`center 1.08 1.0 ease-out` and `1.1 ease-out 0.4`)
        let scale = 1, dur = 1, ease = 'ease-out';
        const nums = a.filter(x => /^\d/.test(x));
        const eas = a.find(x => /ease|linear/.test(x));
        scale = num(nums[0], 1); dur = num(nums[1], 1);
        if (eas) ease = eas;
        await this.zoomTo(scale, instant ? 0 : dur, ease, instant); break;
      }
      case 'camera': {
        const action = a[0] ?? 'sway';
        const dur = num(a[a.length - 1], 0.6);
        if (instant) break;
        this.cameraAction(action, a.find(x => /ease/.test(x)), dur); break;
      }
      case 'shake': {
        const s = a[0] === 'strong' ? 1 : num(a[0], 0.5);
        const d = num(a[1], 0.5);
        if (!instant) this.shake(s, d); break;
      }
      case 'particle': {
        const name = a[0];
        const intensity = num(a[1], 0.5);
        this.setParticle(intensity <= 0 ? null : name, intensity); break;
      }
      case 'filter': this.setFilter(a[0], num(a[1], 1)); break;
      case 'wait': case 'caption': case 'fg': case 'move': case 'costume': case 'mask': break; // handled by player or stubbed
      default: break;
    }
  }
}
