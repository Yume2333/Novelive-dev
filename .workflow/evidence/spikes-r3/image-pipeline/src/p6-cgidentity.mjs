const IP = process.env.NL_IP_DIR ?? new URL("..", import.meta.url).pathname
// P6: CG identity experiment — 3 methods on 2 CG scenes.
// (a) text-only with bible appearance; (b) edit with sprite ref; (c) edit with sprite + place ref.
import { gen, edit, mkdir, writeFileSync } from './api.mjs'
const G = `${IP}/gen/`
mkdir(G)

const STYLE = '视觉小说 CG，民国时代北平，干净的日式动画线稿，柔和赛璐璐上色，电影感构图。'
const XIANGZI_APPEARANCE = '祥子：二十来岁的高壮青年，剃得发亮的平头，右脸颧骨与耳之间一道旧疤，圆眼肉鼻短粗眉，肩背宽厚，神情憨厚有倔劲；穿洗旧白布对襟短褂、黑布肥腿裤扎裤脚、千层底布鞋，肩搭白毛巾。'
const SAFE = '人物和主体动作必须落在画面中央的4:3区域内，左右两侧只画延展街景。'

const scenes = {
  rain: {
    text: `${STYLE}场景：初秋的北平，${XIANGZI_APPEARANCE}祥子弓身拉着自己的新洋车穿过雨后的街道，车轮溅起水光，两旁灰瓦房退成远景，天光灰亮。${SAFE}`,
    sprite: G + 'sprite-xiangzi-puller.png',
    place: G + 'bg-beiping-street.png',
  },
  camels: {
    text: `${STYLE}场景：夜色里，${XIANGZI_APPEARANCE}祥子牵着三匹骆驼走在城外荒野小道上，剪影式处理，人和骆驼的轮廓衬着微亮天边，星光稀疏，远处低矮山影，氛围紧张又疲惫。人物和骆驼必须完整落在画面中央的4:3区域内。`,
    sprite: G + 'sprite-xiangzi-puller.png',
    place: null, // 荒野场景无对应地点基准 → 只用 sprite ref
  },
}

const jobs = []
// (a) text-only
for (const [k, s] of Object.entries(scenes))
  jobs.push([`cgid-${k}-a`, () => gen(s.text, '1792x1008', { meta: { stage: 'cgid', scene: k, method: 'a' } })])
// (b) edit + sprite ref
for (const [k, s] of Object.entries(scenes))
  jobs.push([`cgid-${k}-b`, () => edit([s.sprite], `随附的是角色「祥子」的立绘基准图。画一张 CG：${s.text} 人物长相、发型、疤痕、体型、服装必须与参考图一致。`, '1792x1008', { meta: { stage: 'cgid', scene: k, method: 'b' } })])
// (c) edit + sprite + place
jobs.push(['cgid-rain-c', () => edit([scenes.rain.sprite, scenes.rain.place], `随附第1张是角色「祥子」的立绘基准图，第2张是「北平街道」的背景基准图。画一张 CG：${scenes.rain.text} 街道布局参考第2张，人物长相、发型、疤痕、体型、服装必须与第1张一致。`, '1792x1008', { meta: { stage: 'cgid', scene: 'rain', method: 'c' } })])
// for camels (no place base): 2-image variant = sprite + design sheet (as alt ref)
jobs.push(['cgid-camels-c', () => edit([scenes.camels.sprite, G + 'design-xiangzi.png'], `随附第1张是角色「祥子」的立绘基准图，第2张是他的角色设定图。画一张 CG：${scenes.camels.text} 人物长相、发型、疤痕、体型、服装必须与参考图一致。`, '1792x1008', { meta: { stage: 'cgid', scene: 'camels', method: 'c' } })])

for (const [name, fn] of jobs) {
  const r = await fn()
  if (r.ok && r.buf) { writeFileSync(G + name + '.png', r.buf); console.log(name, 'ok', (r.ms / 1000).toFixed(1) + 's') }
  else console.log(name, 'FAIL', JSON.stringify(r.err))
}
