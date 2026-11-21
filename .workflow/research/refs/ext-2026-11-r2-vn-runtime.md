# R2 调研：VN 运行时（播放器内核）

日期：2026-11-21。读了 Ren'Py（tag `8.5.3.26051504`）、WebGAL 4.6.7（本地克隆，MPL-2.0）、Monogatari v2.8.1（MIT）、TyranoScript（自定义免费许可，禁止再分发）、Naninovel 官方文档（v1.21，闭源）、pixi-vn 1.9.9（LGPL-2.1，动态链接才可）。

## 1. 结论（最重要先说）

1. **两层舞台模型方向已被三个引擎验证**：WebGAL 的 calculation/view 两态、Ren'Py 的 RollbackLog 快照链、pixi-vn 的 GameStepState 快照 + diff，都证明「纯 JSON 状态 + 统一提交点」是回滚/存档/快进三合一的最简解。player.md:11 的方向**正确，直接定稿**。
2. **快照该存什么，WebGAL IStageState 就是清单模板**（§2.1）：背景、各槽位立绘、CG/前景、变换效果、文本、PerformList（活动演出清单）、章内进度。我们只需砍枝（无 BGM/变量/Live2D），字段结构照抄。
3. **快照里必须有"进行中的演出清单"**，而不只是静态状态——这是 player.md 没写的最大缺口。WebGAL `PerformList` 存档后由 `restorePerform` 选择性重放（rerun / rebuildSayPerform / skip 三态），这是"恢复快照后画面和演出都能续上"的关键机制（§2.4）。
4. **回滚=指针移动、不弹栈（roll-forward）我们写对了**，而且比 WebGAL 好：WebGAL 是 pop（无 redo），Ren'Py `forward` 栈 + player.md:70 的"指针不移出"语义等价 Ren'Py。
5. **已读按句子 ID 集合是正确选择且比同行都稳**：Ren'Py 用 `_seen_ever` 记 AST 节点名（脚本一改就漂），WebGAL 用"场景名+句子序号"位图（场景重排就错），Tyrano 用 maxBackLogNum 条文本。我们的句尾随机短 ID 在内容修改后稳定（work-format.md:92），是最优键。
6. **自动播放计时公式**：Ren'Py/Tyrano 都是线性 `base + per_char × 字符数`，WebGAL 是 `打印耗时 + 固定间隔 250~1750ms`。对 CJK 逐字文本，Ren'Py 线性公式更合适，建议 `停留 = 用户档位系数 × (句长 + 常数)`（§2.6）。
7. **粒子不要装 @pixi/particle-emitter**：它 peerDependencies 写死 pixi 6/7（`<8.0.0`），v8 不兼容。WebGAL 三个粒子（雨/雪/樱）是手写 ParticleContainer 逐帧更新，各 ~150-200 行，数学可移植改写——比装依赖更稳（§2.8）。
8. **滤镜用 pixi-filters 6.1.5（MIT）**：内含 GlitchFilter、AdjustmentFilter（亮度/对比/饱和）、KawaseBlurFilter；sepia 用 pixi 核 ColorMatrixFilter.sepia()。我们首批 blur/brightness/sepia/glitch 全覆盖（§2.9）。
9. **@pixi/react 8.0.5 要求 React≥19 可用，但不该用**：WebGAL、pixi-vn 两个 Pixi VN 引擎都用命令式 stage——因为舞台状态是纯 JSON 快照，命令式 sync 比声明式 React 树更直。React 只管 DOM 界面层（§2.10）。
10. **缺口清单**（§4）：快照字段表、PerformList/选择性重放、自动计时公式、文字速度范围、预载窗口、存档迁移失败兜底、转场 shader 方案、纹理卸载纪律。

## 2. 证据

### 2.1 快照状态模型

- **WebGAL 两态**：`stageStateManager` 持 `calculationStageState`（命令执行同步写）和 `viewStageState`（commit 后 React/Pixi 同步）；`commit()` 深拷贝一份过去。命令函数只写演算态、返回 IPerform，startFunction 只做运行动作。
  源：`/tmp/webgal/packages/webgal/src/Core/Modules/stage/stageStateManager.ts:89-98, 409-432`，commit 在 `:409`。
- **WebGAL IStageState 字段**（快照即存档）：bgName/oldBgName、figName{Left,Right,Left13,Right13,Left14,Right14}/freeFigure/characterFigures、isRead、showText/showName、command、choose、vocal/bgm/uiSe/miniAvatar、GameVar、effects（每 target 一个 transform）、animationSettings、bgTransform/bgFilter、**PerformList**、currentDialogSegments/isDialogNotend、enableFilm、isDisableTextbox。
  源：`/tmp/webgal/packages/webgal/src/Core/Modules/stage/stageInterface.ts:224-271`。
- **WebGAL 存档结构**：`{nowStageState(深拷贝), backlog[], index, saveTime, sceneData{currentSentenceId, sceneStack, sceneName, sceneUrl, currentLocals}, previewImage}`；缩略图是把 Pixi canvas drawImage 到 480×270 canvas 再 `toDataURL('image/webp', 0.5)`。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/storage/saveGame.ts:30-71`。
- **Ren'Py Rollback 对象**：`context(rollback_copy) + objects(对象逆操作token) + stores{store→diff} + random + checkpoint/hard_checkpoint/forward`；`RollbackLog` 长度受 `config.rollback_length` 限制，`hard_rollback_limit` 控制可回退步数。Ren'Py 快照=上下文浅拷贝+store diff（pickle 可序列化），我们不拷这套对象模型，但"快照=上下文+可变状态 diff"的结构同构。
  源：`/tmp/nl-r2/VnRuntime/renpy/renpy/rollback.py:234-310, 457-505`。
- **pixi-vn GameStepStateData**：`{path, storage, labelIndex, canvas, openedLabels, sound}`；canvas 快照=`{tickers, elements{alias→CanvasBaseItemMemory}, stage, elementAliasesOrder}`。历史是 step→diff 增量（microdiff），不是全量——WebGAL 全量快照更简单，我们照 WebGAL。
  源：`/tmp/pixi-vn/src/interfaces/GameStepStateData.ts`、`src/canvas/interfaces/CanvasGameState.ts`、`src/canvas/CanvasManager.ts:646-720`。
- **Monogatari 存档**：`{name, date, image, game:{history, state, storage}, screenshot?}`，JSON 经 Storage adapter；`loadFromSlot` 里 step 越界时向前收（`while step > labelLength-1: step--`），版本迁移走 `upgrade(oldV,newV,callbacks)` + `migrate()`。
  源：`/tmp/nl-r2/VnRuntime/monogatari/src/engine/persistence.ts:33-95, 288-445`。

### 2.2 回滚 / roll-forward

- **Ren'Py forward 栈**：rollback 时把每个 Rollback 的 `forward` 数据压进 `self.forward`（Forward(name,data,fixed)）；roll_forward_info() 在重演该语句时返回那份数据让 interact 直接跳过。这是"回滚后能前滚"的标准语义。
  源：`/tmp/nl-r2/VnRuntime/renpy/renpy/rollback.py:763-790, 990-1000`；`renpy/exports/rollbackexports.py:29-58`。
- **硬/软检查点**：`checkpoint(hard=True)` 占 `hard_rollback_limit` 名额；硬=回滚停点，软=路过不停。回滚定位逻辑：`can_rollback` 找最近 hard_checkpoint 且 `script.has_label` 的点。
  源：`/tmp/nl-r2/VnRuntime/renpy/renpy/rollback.py:736-760, 876-905`。
- **WebGAL 是 pop 不是指针**：`jumpFromBacklog` 把 index 之后的项 pop 掉（无 redo），然后 `isSaveBacklogNext=true` 补记当前句。我们的"指针不移出"比它强，等价 Ren'Py。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/storage/jumpFromBacklog.ts:108-118`。
- **backlog 上限**：WebGAL `backlog_size=200`；Tyrano `maxBackLogNum` 超过即 `shift()`（FILO）。
  源：`/tmp/webgal/packages/webgal/src/config/index.ts:2`；`/tmp/nl-r2/VnRuntime/tyrano/tyrano/plugins/kag/kag.js:1591-1619`。

### 2.3 已读追踪

- **Ren'Py**：`persistent._seen_ever` 记 `self.current`（AST 节点名）；`seen_session` 记本会话；`_seen_translates` 按译文 identifier（`hash64` 可选）。跳过已读判定 `seen_current(ever=True)`。
  源：`/tmp/nl-r2/VnRuntime/renpy/renpy/execution.py:725-730, 972-988`；`renpy/ast.py:2935-2948`；`renpy/exports/persistentexports.py:48-62`。
- **WebGAL**：`ReadHistoryManager` 按 `sceneName → Uint8Array` 位图，位索引=sentenceIndex，base64 存 IndexedDB；场景更新导致 index 溢出时扩容保留旧位（防位移）。
  源：`/tmp/webgal/packages/webgal/src/Core/Modules/readHistory.ts:78-145`。
- **Naninovel**："Skip Read Text" 把已执行命令记进**全局 state**（单个 global save slot），不随 game save。
  源：https://naninovel.com/guide/state-management §Global state（2026-11-21 读）。
- 结论：三家都是"已读集合独立于存档存全局态"。我们句子 ID 键最稳（Ren'Py 的 AST 名和 WebGAL 的序号都会在内容改动后漂移）。

### 2.4 恢复快照后重放演出（快照+选择性重放）

- **WebGAL restorePerform**：backlog 项存的是该句落点的完整 stageState（含 `PerformList: {id, isHoldOn, script}`）；恢复时 stopAllPerform → 恢复 stageState → 按 RestoreMode 逐条处理 PerformList：**say=rebuildSayPerform（只重建演出不重跑，防 concat 重复追加）；相对动画=skip（防叠加）；其余=rerun（runScript 重执行）**。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/storage/jumpFromBacklog.ts:23-82, 85-137`。
- **WebGAL backlog 写入点**：`scriptExecutor` 里 `isSaveBacklog = (command===say && !notend)`，每句 say 落点时存一份 calculationState 深拷贝；`saveCurrentStateToBacklog` 里把 PerformList 里 concat 参数洗成 false（防重放时再追加）。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/gamePlay/scriptExecutor.ts:134-160`；`Core/Modules/backlog.ts:38-67`。
- **Ren'Py rollback 落点=语句起点**（greedy 往前退到上个 checkpoint 之后），恢复后重演执行，RNG 复位；`in_fixed_rollback`/`after_rollback` 禁慢速。
  源：`/tmp/nl-r2/VnRuntime/renpy/renpy/rollback.py:894-1043`。
- 结论：我们"跳回历史句=恢复快照再重演演出"要写清三态规则：**纯演出指令（@bg/@show/@camera/@filter/@particle/@caption）可重跑（幂等状态写）；文本句不重跑只重建文本演出；累积型/相对动画跳过**——`.nvs` 指令全是意图式状态写，幂等性天然比 WebGAL 好（它没有 concat 追加问题，因为我们文本就是状态不是增量）。

### 2.5 PerformList / IPerform 生命周期

- **IPerform**：`{performName, duration, isHoldOn, startFunction?, isStarted?, stopFunction, blockingNext(), blockingAuto(), blockingStateCalculation?(), goNextWhenOver?, skipNextCollect?}`。三个 blocking 维度分开：blockingNext（挡用户点击/内部推进）、blockingAuto（只挡自动）、blockingStateCalculation（挡本轮 -next 继续演算）。
  源：`/tmp/webgal/packages/webgal/src/Core/Modules/perform/performInterface.ts:7-33`。
- 用法示例：say perform `blockingNext:false, blockingAuto:true`——打字机不挡玩家点击（点击补完是 UI 层），但挡 auto；粒子/镜头 isHoldOn 持续演出。`goNextWhenOver` 供 notend 句演完自动接下句。
  源：`/tmp/webgal/packages/webgal/src/Core/gameScripts/say/createSayPerform.ts:40-56`。
- 建议：我们的"演出"抽象直接照抄这套字段，砍掉 blockingStateCalculation（我们无 -next 连续演算链、无变量条件），保留 blockingNext/blockingAuto/goNextWhenOver/isHoldOn/performName/duration/stopFunction。

### 2.6 自动播放 & 文字速度

- **Ren'Py afm**：`afm_delay = (afm_bonus + afm_length) / afm_characters × afm_time + dialogue_pause + 文本剩余慢速时间`；`afm_characters=250, afm_bonus=25`，`afm_time` 是用户档位（秒/250字符）。即**线性按字符数**。
  源：`/tmp/nl-r2/VnRuntime/renpy/renpy/display/behavior.py:731-759`；`renpy/config.py:223-226`。
- **Tyrano**：`auto_speed = autoSpeed + autoSpeedWithText × 字符数`（同样线性）。
  源：`/tmp/nl-r2/VnRuntime/tyrano/tyrano/plugins/kag/kag.tag.js:2629-2648`。
- **WebGAL**：`autoPlayDelay = 250 + (100-speed)×15`ms（档位 0-100 → 250~1750ms 固定间隔），100ms 轮询检查 blockingAuto；say 演出本身 blockingAuto=true 直到文本出完。等效于"出完+固定停顿"。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/gamePlay/autoPlay.ts:62-75`。
- **Monogatari**：`AutoPlaySpeed`（默认 5 秒）从文本出完起计时，drift 补偿 setTimeout。
  源：`/tmp/nl-r2/VnRuntime/monogatari/src/engine/ui.ts:250-278`；`src/monogatari.ts:500-503`。
- **文字速度**：WebGAL `textDelay = 3 + (100-speed)×1.5`ms/字（3~153ms），`textAnimationDuration = 200 + (100-speed)×15`ms；Monogatari `TextSpeed=20`ms/字；Tyrano `chSpeed` 默认 30ms/字。
  源：`/tmp/webgal/packages/webgal/src/hooks/useTextOptions.ts:11-20`；`src/monogatari.ts:497`；`tyrano/plugins/kag/kag.tag.js:2095-2099`。
- **建议公式**（CJK 友好、沿用 Ren'Py 语义）：`autoDelay = userSecPer250Chars × (25 + 句长)/250`，等价写作 `base + rate×句长`，例如档位默认 `1.2s + 0.08s×字符数`，可调范围 0.5~4×。打字速度滑块直接映射 ms/字（WebGAL 式 `3~153ms`），并给"瞬间"档（0ms）。

### 2.7 跳过已读

- **Ren'Py**：`skipping` 模式 fast（Ctrl 按住）/slow（toggle）；`skip_unseen` 偏好默认 false——`skip_unseen=true` 或 `seen_current(true)` 才跳；每句 say 检查 `elif tlid and seen_translation(tlid)`。
  源：`/tmp/nl-r2/VnRuntime/renpy/renpy/display/behavior.py:812-830`；`renpy/character.py:606-624, 660-666`。
- **WebGAL**：`fast_timeout=50`ms 轮询 `isRead`，遇未读 `stopFast()`；`skipAll` 选项允许跳全部。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/gamePlay/fastSkip.ts:36-52`。
- 我们 decisions 已定"不做跳过未读"，与 Ren'Py 默认一致。细节补：**skip 时每句仍要结算瞬时演出**（Ren'Py 跳过的是文字慢速 `slow=False, all_at_once=True`，不是跳过场景指令）——我们跳过已读时舞台指令照常瞬时生效（转场/立绘换图立即跳最终态），只文字秒出+不停顿。

### 2.8 粒子（雨/雪/樱）

- **@pixi/particle-emitter 5.0.10 peerDeps = `@pixi/* >=6.0.4 <8.0.0`——Pixi 8 不兼容**，无官方 v8 版。
  源：https://registry.npmjs.org/@pixi%2fparticle-emitter（2026-11-21 查）。
- **替代**：`@spd789562/particle-emitter` 1.0.2（pixi-v8 重写，MIT）；`pixi-v8-particles` 0.1.3（MIT，peer `^8`）。都是第三方小包、维护度低。
  源：npm registry（2026-11-21 查）；https://github.com/spd789562/pixi-v8-particle-emitter。
- **WebGAL 三粒子**：手写 `PIXI.ParticleContainer` + ticker 逐帧改 vx/vy/rotation，各 ~150-200 行：snow=飘落+旋转+风速、rain=密集直线+角度、cherryBlossoms=飘落+摆动。fg/bg 双层容器挂 stage。
  源：`/tmp/webgal/packages/webgal/src/Core/gameScripts/pixi/performs/{snow,rain,cherryBlossoms}.ts`（MPL-2.0，重写数学不拷文件）。
- **Monogatari**：粒子=具名注册表 `{name: config}`，脚本 `show particles <name>`。
  源：`/tmp/nl-r2/VnRuntime/monogatari/src/actions/Particles.ts`。
- 建议：照 gap-ledger E14「移植改写」做 3 个内置粒子（~200 行/个手写 ParticleContainer），不装 emitter 库——参数集只有强度/速度/风向角（work-format.md:74 已定），外部库的泛化配置反而是包袱。

### 2.9 滤镜 & 转场

- **pixi-filters 6.1.5（MIT，peer `pixi.js>=8`）**含：GlitchFilter、AdjustmentFilter(brightness/contrast/saturation/gamma/RGB)、KawaseBlurFilter、OldFilmFilter、RGBSplitFilter、ShockwaveFilter、GodrayFilter 等；LICENSE=MIT（Mathew Groves/Chad Engler）。
  源：npm `pixi-filters@6.1.5` tarball `lib/` 目录枚举 + `package/LICENSE`（2026-11-21 下载验证）。
- **Blur**：pixi 8 核心自带 `BlurFilter`（WebGAL 用 `PIXI.filters.BlurFilter`）。sepia 用核心 `ColorMatrixFilter.sepia()`。亮度/对比用 pixi-filters `AdjustmentFilter`。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/stage/pixi/WebGALPixiContainer.ts:52-63, 100-112`；pixi-filters 6.1.5 tarball。
- **WebGAL 滤镜注册表模式**：`FILTER_CONFIGS {blur,oldFilm,dotFilm,reflectionFilm,glitchFilm,rgbFilm,godrayFilm,shockwave,adjustment,radiusAlpha,bevel}`，每项 `{priority, create, isDefault}`，按 priority 排滤镜数组顺序，isDefault 判空自动剔除——**这套"具名注册表+默认值剔除"可直接移植**。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/stage/pixi/WebGALPixiContainer.ts:37-160`（MPL-2.0，重写）。
- **转场**：work-format.md:72 已定枚举 fade/dissolve/wipe-*/slide/push/iris/zoom/none。WebGAL 转场走 animationSettings+WebGL 转场动画表（animationFunctions/animationTracks）；Ren'Py 转场是 Displayable 类（Dissolve=混合两个 scene 截图、PushMove/CropMove、ImageDissolve 用灰度图控制溶解顺序）。**建议 wipe/iris 用 shader mask（自写小 shader，~100 行内），dissolve/fade 用 alpha 混合，slide/push/zoom 用 transform 动画**——不用拷引擎代码，pixi Filter+uniform 写 mask 转场是标准做法。
  源：`/tmp/webgal/packages/webgal/src/Core/gameScripts/setTransition.ts`；`/tmp/nl-r2/VnRuntime/renpy/renpy/display/transition.py:320-446, 730-987`。

### 2.10 @pixi/react vs 命令式 stage

- **@pixi/react 8.0.5**（MIT）：peer `pixi.js ^8.2.6, react >=19.0.0`——React 19 兼容没问题（2025-03 发布的 v8 专为 React 19 做）。
  源：npm registry；https://pixijs.com/blog/pixi-react-v8-live。
- **但两个 Pixi VN 引擎都用命令式**：WebGAL `PixiStage`/`PixiController` 手写 app+container+animation 表，React 只包 UI 层；pixi-vn `CanvasManager` 命令式 add/remove/export/import JSON。**原因相同：舞台状态是纯 JSON 快照，同步逻辑是按字段 diff 写 Pixi 对象（syncPixiStageState），不是 React 组件树**；@pixi/react 的声明式模型反而要额外维护"快照→JSX"的映射层。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/stage/pixi/`；`/tmp/pixi-vn/src/canvas/CanvasManager.ts`。
- 建议：**舞台层命令式 PixiJS（像 WebGAL），界面层 React DOM**，不装 @pixi/react。docs 已定"界面层仍是 DOM"（player.md:11），本条只是落到包选择。

### 2.11 纹理内存 & 预载窗口（2K/4K WebP）

- 单张 2K (2560×1440) RGBA8 = **14.7MB**（+mipmap 33% ≈19.7MB）；4K = **33.2MB**（+mipmap ≈44MB）。一幕典型 ~7 张（背景+几个立绘+CG+前景）：2K ≈103MB，4K ≈232MB（含 mipmap ≈310MB）。[INFERENCE 由像素公式得]
- **Ren'Py**：`predict_statements=32`（BFS 预读 32 句）、`image_cache_size_mb=400`；预读走每条 AST 节点的 `predict()` 方法收集图片名。
  源：`/tmp/nl-r2/VnRuntime/renpy/renpy/config.py:99-106`；`renpy/display/predict.py:78-160`；`renpy/execution.py:887-963`。
- **WebGAL**：`PROGRESS_ASSET_LOOKAHEAD=20` 句窗口，`ASSET_PREFETCH_INTERVAL_MS=220` 间隔发 `<link rel=prefetch>`；AssetManager 用 `future`(预取意愿)+`owners`(舞台持有) 集合差决定卸载，`collect()` 延迟重算避免误卸；`renderer.plugins.prepare.add(texture)` 预上传 GPU。
  源：`/tmp/webgal/packages/webgal/src/Core/util/prefetcher/{assetsPrefetcher,progressPrefetcher,pixiPrefetcher}.ts`；`Core/controller/stage/pixi/assets/AssetManager.ts`。
- **Naninovel** 三档资源策略（Conservative/Optimistic/Lazy）：Conservative=场景边界整块预载卸载（回滚在同场景内快）；Lazy=不预载、按 Lazy Buffer 句数前看。
  源：https://naninovel.com/guide/memory-management（2026-11-21 读）。
- **Pixi v8 卸载**：`Assets.unload(url)` 清缓存 + `texture.destroy(true)` 毁 GPU 资源；对象需显式 destroy（GC 回收不了 GPU 端）。
  源：https://pixijs.com/8.x/guides/concepts/garbage-collection；`pixijs.download/v8.14.x/docs/assets.Assets.html#unload`。
- 建议：**预载窗口=前看 N 句（取 20~32，对齐两家）**+ 舞台持引用计数，"不在窗口内且无舞台引用"才 `Assets.unload`+`texture.destroy(true)`；4K 时收紧窗口或改整章预载上限（如 ≤12 张图≈400MB 以内）。

### 2.12 其余引擎细节

- **WebGAL parser `ADD_NEXT_ARG_LIST`**：bgm/pixi/label/setVar/filmMode/playEffect/setTransition/applyStyle 等"设置型"命令自动加 `next=true` 不等点击——我们"行前指令随行生效"已覆盖，但**指令属性表要把"设置型默认随行、文本型停点击"写显式**（M1a 定稿时）。
  源：`/tmp/webgal/packages/parser/src/config/scriptConfig.ts:46-62`。
- **Monogatari 逆操作模型**：每个 action 实现 `willApply/apply/didApply + willRevert/revert/didRevert`——回滚靠逆操作，被自己官方存档迁移补丁打脸过，**不抄，抄快照**（gap-ledger 已判，复核确认）。
  源：round-1 `ext-2026-11-visual-pipeline.md` B1.4 + `/tmp/nl-r2/VnRuntime/monogatari/src/actions/Dialog.ts:48-524`（NVL history 用栈快照而非逆操作，印证）。
- **存档截图**：WebGAL 480×270 webp q0.5 缩略图——我们 Electron 里 stage 是 Pixi canvas，同法可拷（`canvas.toDataURL`）或 `app.renderer.extract`。
  源：`/tmp/webgal/packages/webgal/src/Core/controller/storage/saveGame.ts:42-53`。

## 3. 对照现有设计

| 发现 | 状态 | 位置 |
|---|---|---|
| 两态舞台（JSON 逻辑态+提交渲染态，快照读写） | 已覆盖 | docs/player.md:11 |
| 快照=素材引用+状态 JSON 不存图片本体 | 已覆盖 | docs/player.md:69 |
| 回滚=backlog 快照、跳回历史句=恢复快照重演 | 已覆盖 | docs/player.md:69 |
| 回滚不弹栈只移指针（roll-forward 语义） | 已覆盖 | docs/player.md:70；比 WebGAL pop 强，等价 Ren'Py forward 栈 |
| 跳过已读按句子 ID、回滚/跳回经过句算已读 | 已覆盖 | docs/player.md:71；句子 ID 稳定（work-format.md:92）优于三家 |
| 同槽位同尺寸换表情 200ms 混合、不同尺寸淡入淡出 | 已覆盖 | docs/player.md:24；WebGAL figureTextureBlend 验证（200ms ADD 混合） |
| 转场/缓动/粒子/滤镜枚举 | 已覆盖 | docs/work-format.md:70-76 |
| 存档迁移按场景+句子 ID、对不上保留 | 已覆盖 | docs/player.md:97、docs/work-format.md:157 |
| **快照字段表**（PerformList/活动演出清单必须进快照） | 缺口 | player.md:69 只说"舞台状态快照"未列字段；应在 player.md 或新 specs 写 IStageState 等价字段表 |
| **恢复快照的选择性重放三态规则** | 缺口 | player.md:69"重演演出"未写规则；应写：意图指令幂等可重跑、文本句只重建文本演出、累积动画跳过 |
| **IPerform 生命周期字段**（blockingNext/blockingAuto/goNextWhenOver/isHoldOn/duration/stopFunction/performName） | 缺口 | player.md 未写演出抽象；粒子/镜头 hold-on 与 auto 阻塞是同一问题 |
| **自动播放计时公式** | 缺口 | player.md:57 只有"自动播放"一项；建议 `base + rate×句长`（Ren'Py/Tyrano 线性式），写进 player.md |
| **文字速度范围** | 缺口 | player.md:61"文字速度"无范围；建议 ms/字滑块 3~153ms + "瞬间"档（WebGAL 式） |
| **预载窗口** | 缺口 | 两文档均无预载设计；建议前看 20~32 句 + 引用计数卸载（WebGAL AssetManager / Ren'Py predict_statements=32 验证） |
| **纹理卸载纪律**（`Assets.unload`+`texture.destroy(true)`） | 缺口 | docs 无；2K/4K WebP 下 ~100-300MB/场景，必须写 unload 时机 |
| **存档截图缩略图** | 缺口 | player.md 无存档缩略图；WebGAL 480×270 webp q0.5 可拷 |
| **存档迁移失败兜底** | 缺口 | player.md:97"对不上的旧存档保留"未写"对上了但快照字段缺新字段/素材删了"的兜底；WebGAL `characterFigures ??= []`、Monogatari step 越界收敛是先例 |
| **跳过已读时瞬时演出处理** | 缺口 | player.md:71 未写跳过中舞台指令怎么办；Ren'Py 语义=指令照常瞬时生效只禁慢速 |
| **指令属性表：设置型默认随行/文本型停点击** | 缺口 | work-format.md:78-84 隐含未显式；WebGAL ADD_NEXT_ARG_LIST 先例，M1a 定稿时写清 |
| **@pixi/react 不用、粒子库不装** | 新决策点 | decisions.md:666 只说"PixiJS 8"；包选择未写 |
| 历史列表就是回滚栈、存档=快照+位置 | 已覆盖 | docs/player.md:69 |
| 行内演出指令不做 | 已覆盖 | decisions.md:672"暂不做"、gap-ledger E18 |
| 分支/变量不做 | 已覆盖 | player.md:101 |

## 4. 可拷资产

| 资产 | 位置 | License | 大小 | 用法 |
|---|---|---|---|---|
| WebGAL `IStageState` 字段表 | `packages/webgal/src/Core/Modules/stage/stageInterface.ts:224-271` | MPL-2.0 | ~50 行 | 只参考重写（文件级 copyleft，不拷文件；字段语义可借鉴） |
| WebGAL `restorePerform` 三态规则 | `jumpFromBacklog.ts:23-82` | MPL-2.0 | ~60 行 | 移植改写（思路不受版权保护） |
| WebGAL `IPerform` 接口 | `perform/performInterface.ts` | MPL-2.0 | ~30 行 | 移植改写 |
| WebGAL 三粒子数学 | `performs/{snow,rain,cherryBlossoms}.ts` | MPL-2.0 | ~150-200 行×3 | 移植改写（重写代码） |
| WebGAL `FILTER_CONFIGS` 注册表模式 | `WebGALPixiContainer.ts:37-160` | MPL-2.0 | ~120 行 | 移植改写 |
| Ren'Py `afm` 公式 + `_seen_ever`/`forward` 语义 | `display/behavior.py:731-759`、`rollback.py` | MIT | — | 移植改写（语义） |
| Monogatari 粒子注册表概念、AutoPlaySpeed 语义 | `Particles.ts`、`monogatari.ts:500` | MIT | — | 移植改写 |
| WebGAL `readHistory` 位图结构（若选位图） | `readHistory.ts` | MPL-2.0 | ~140 行 | 只参考（我们用 Set<ID> 更简单） |
| **pixi-filters 6.1.5** | npm | MIT | 包 | 直接依赖 |
| **pixi.js 8.23.0** | npm | MIT | 包 | 直接依赖（已定） |
| TyranoScript backlog/auto 公式 | `kag.tag.js:2629-2648` | 自定义免费许可（禁止再分发代码） | — | 只参考（语义） |
| Naninovel 资源策略三档 | 官方文档 | 闭源产品 | — | 只参考 |
| pixi-vn GameStepStateData 快照结构 | `src/interfaces/` | LGPL-2.1 | — | 只参考 |

## 5. 需要所有者取舍的事

1. **快照粒度**：(a) 每句 say 落点存全量 stageState（WebGAL，~15KB×200=3MB）；(b) 存 diff 增量（pixi-vn）；(c) 只存语句指针+场景头重演（Narrat）。**推荐 (a)**：纯 JSON、回滚瞬时、跨章天然支持；200 上限对齐 WebGAL/Tyrano。
2. **回滚栈上限**：WebGAL 200 / Tyrano maxBackLogNum / Ren'Py rollback_length。**推荐 200**，句 ID+舞台 JSON 成本可忽略。
3. **自动播放公式**：(a) Ren'Py/Tyrano 线性 `base+rate×len`；(b) WebGAL 固定间隔。**推荐 (a)**：长短句体验一致，CJK 每字独立；默认建议 `1.2s + 0.08s×字符数`，滑块调倍率。
4. **预载窗口**：(a) 前看固定句数（20~32）；(b) 整章预载；(c) 不预载。**推荐 (a) 20~32**（对齐两家默认值），4K 模式下降窗口。
5. **历史列表数据源**：(a) backlog 快照本身渲染列表（WebGAL）；(b) 独立历史文本记录（Ren'Py HistoryEntry/Tyrano tf.system.backlog）。**推荐 (a)**：player.md:69 已说"历史列表读这些快照"，一致。
6. **跳过已读时演出**：(a) 瞬时结算（Ren'Py，转场跳终态）；(b) 演出仍播。**推荐 (a)**：与"跳过要快"的意图一致。
7. **@pixi/react**：不用（两家 Pixi VN 均命令式）。**推荐命令式 stage**——但这是一行 decisions 级别的事，请 Main 确认是否要写进 decisions.md。
8. **存档缩略图**：做不做？WebGAL/Monogatari 都做。**推荐做**（480×270 webp，Electron 里 `canvas.toDataURL` 或 `app.renderer.extract` 一行事）。
