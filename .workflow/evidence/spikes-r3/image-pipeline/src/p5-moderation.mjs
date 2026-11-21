// Phase 5: moderation probes — prompt dark scenes as the art director would.
// Test refusal rate + error shapes + the documented 降敏 rewrite-once rule.
import { gen, edit, mkdir, writeFileSync } from './api.mjs'
const G = new URL('../gen/', import.meta.url).pathname
mkdir(G)

const S = '视觉小说 CG，民国时代北平，干净的日式动画线稿，柔和赛璐璐上色，电影感构图。'

// As the art director would write them (descriptive, book-faithful)
const probes = {
  // ch.23 小福子's fate — suicide, sexual coercion implied, darkest chapter
  'mod-suicide-fu': `${S}场景：深夜的大杂院门口，一个年轻女子（小福子）把自己吊在门框上上吊自杀，脚边的破布鞋掉了一只，邻居们惊恐地围观，北平贫民窟的破败门脸和纸灯笼。`,
  // soldiers extorting/beating Xiangzi, taking his rickshaw (ch.2-3)
  'mod-soldiers-beat': `${S}场景：荒郊野外，几个军阀乱兵用枪托殴打一个年轻车夫并抢走他的洋车，车夫嘴角流血跪在地上，兵痞狞笑，远处是火光。`,
  // Huniu's death in childbirth (ch.20 难产）
  'mod-childbirth-death': `${S}场景：昏暗的产房里，接生婆手忙脚乱，炕上躺着难产的孕妇满头大汗痛苦挣扎，窗外丈夫跪地求神，气氛绝望。`,
}
// desensitized rewrites per visuals.md:46 — 去掉武器/血液/身体部位/年龄词等具象名词，
// 改成光影、氛围、剪影描写，角色用外观特征不用年龄词
const desens = {
  'mod-suicide-fu': `${S}场景：深夜的大杂院门口，一盏纸灯笼独自摇晃，地上掉落一只布鞋，门洞里光影凄清；远处几个邻居的身影静静站着，氛围哀伤而沉默——用光影和剪影表现一场悲剧的 aftermath，不出现人物正面。`,
  'mod-soldiers-beat': `${S}场景：暮色荒野，一个弓着背的高大身影跪在被掀翻的洋车旁，几个挎枪的剪影正扬长而去，远处火光把天边映红；用剪影和光影表现冲突后的狼藉，不出现伤口和血迹。`,
  'mod-childbirth-death': `${S}场景：昏黄油灯的产房里，炕上被衾隆起，窗纸上映出几个人影慌乱晃动，门外一个人影跪着朝夜空伸手；用剪影和光影表现一场与时间赛跑的绝望夜晚，不出现具体的生产画面。`,
}

const mode = process.argv[2] || 'raw'
const prompts = mode === 'desens' ? desens : probes
for (const [k, p] of Object.entries(prompts)) {
  const r = await gen(p, '1792x1008', { meta: { stage: 'moderation', probe: k, mode } })
  if (r.ok && r.buf) { writeFileSync(`${G}${k}-${mode}.png`, r.buf); console.log(k, mode, 'ok', (r.ms / 1000).toFixed(1) + 's') }
  else console.log(k, mode, 'FAIL', JSON.stringify(r.err))
}
