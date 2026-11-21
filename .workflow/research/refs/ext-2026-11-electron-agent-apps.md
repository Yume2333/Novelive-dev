# 嵌 Agent/LLM 的开源桌面应用架构调研

调研日期 2026-11-21。目标：Electron/桌面应用里嵌 Agent 或 LLM 聊天的架构模式——进程划分、IPC 流式传输、SQLite 选型、后台任务存活、崩溃恢复、通知、Key 存储、自动更新、设置 UI、MCP、日志。

本轮实际读源码（克隆到 /tmp/nv-research/）：block/goose（Apache-2.0）、chatboxai/chatbox（GPL-3.0）、nanbingxyz/5ire（改良 Apache-2.0）、CherryHQ/cherry-studio（AGPL-3.0/双许可，sparse）、TohmaN233/YN-translation-workshop（MIT）。LobeHub desktop 只读了官方架构 README（LobeHub Community License，自定义非 OSI 许可）。jan（Tauri/Rust，Apache-2.0）和 anything-llm（MIT 但桌面端只是套壳 Electron + 本地服务器）与 Electron 架构问题相关性低，未深入。

## 许可证核实（任务点名复查）

| 项目 | 许可证 | 可否拷贝 |
|---|---|---|
| block/goose (ui/desktop) | Apache-2.0 | **可拷贝**（需署名 NOTICE） |
| TohmaN233/YN-translation-workshop | MIT | **可拷贝** |
| CherryHQ/cherry-studio | AGPL-3.0 + 用户分段双许可（>10 人组织要商业授权） | **只参考**，一行都不能搬 |
| chatboxai/chatbox | GPL-3.0 | **只参考** |
| nanbingxyz/5ire | 改良 Apache-2.0（附加商标声明与商用条款 3.2） | 可移植小片段但须加 "based on 5ire Community Edition" 声明；**建议只参考**，自写同形代码成本很低 |
| lobehub/lobehub apps/desktop | LobeHub Community License（非标准） | **只参考** |
| Mintplex-Labs/anything-llm | MIT（但 Electron 桌面只是壳，核心在 server） | 参考价值低 |
| janhq/jan | Apache-2.0（Tauri，不是 Electron） | 参考价值低 |

## 1. 进程模型与后台进程管理

### Goose：`goosed` sidecar + localhost HTTP/WS + ACP（Apache-2.0，可拷贝）

`ui/desktop/src/gooseServe.ts`（607 行）：Electron 主进程 `spawn` 打包进 resources 的 Rust `goose` 二进制，跑 `goose serve --host 127.0.0.1 --port <动态端口>`。

- **动态端口**：`findAvailablePort()` 用 `createServer().listen(0,'127.0.0.1')` 拿空端口（gooseServe.ts:101-115）。
- **每次启动随机 secret**：`GENERATED_SECRET = crypto.randomBytes(32).toString('hex')`（main.ts:849），经 env `GOOSE_SERVER__SECRET_KEY` 传给子进程；WS URL 带 `?token=` 查询参数，`redactedAcpUrl` 单独造一份把 token 替换为 `REDACTED` 用于日志（gooseServe.ts:243-269）——**日志里永远不写凭证**，值得抄。
- **就绪探测**：轮询 `GET /status`，30s 超时、100ms 间隔；stderr 用正则 `panicked at|RUST_BACKTRACE|fatal error` 判致命错误提前失败；`errorLog` 环形留尾部 100 行随错误抛出（gooseServe.ts:155-236）。
- **启动诊断**：`startupDiagnostics.ts` 把 spawn_start/pid/healthcheck 各事件+stderr 尾部落成 `userData/logs/` 下 JSON 文件，错误消息里带诊断文件路径——**正好是我们 M0「崩溃横幅显示日志位置」的做法样板**。
- **退出清理**：SIGTERM → 5s 后 SIGKILL；Windows 用 `taskkill /pid /f /t`（gooseServe.ts:484-510）。`will-quit` 时 `gooseServeLeases.cleanupAll()`（main.ts:3096）。
- **窗口关掉进程不死**：lease 按 windowId 集合管理（gooseServeLeaseRegistry.ts），窗口关闭只解绑不杀后端；这与我们「窗口关闭不杀创作端」同构。

**对我们的映射**：我们不 spawn 二进制也不起 HTTP，但「随机 secret+redacted URL 记日志」「stderr 致命模式提前失败」「就绪探测+诊断文件」「SIGTERM→SIGKILL 5s 宽限」可直接搬进 utilityProcess 管理器。utilityProcess 的 fork/kill/exit 事件替代 spawn/healthcheck，`creator.ready` 帧即就绪信号，比 HTTP /status 更简单。

### Cherry Studio：utilityProcess 框架（AGPL，只参考）

`src/main/core/utilityProcess/` + `docs/dev/references/utility-process/`（文档完整，149+157 行）——**这是本轮最重要的参考**。他们把 utilityProcess 做成了带协议状态机的框架：

- **握手**：fork 后 `parentPort` 上只发一帧 `connect`，把私有 `MessageChannelMain` 的一端转给子进程；之后 parentPort 完全不再用，所有流量走私有端口——**和我们 M0 的 MessagePort 直连设计完全一致，且他们多了一步：帧带身份字段**。
- **帧身份**：每帧 `{protocol:'cherry.utility-process', version:2, processId, generation}`。generation 单调递增，死掉一代的迟到帧是致命违规——**这直接解决我们「重连后旧请求的结果不再生效」的实现细节：换 port + generation 字段双重保险**。版本不匹配子进程 exit 70。
- **请求 ID**：每代单调从 1 起，子进程只记 high-water mark（不用 set）。
- **取消两档**：`cooperative`（发 cancel 帧，子进程 abort 该请求的 AbortSignal，迟到 terminal 被 tombstone 丢弃）和 `terminate`（直接杀这一代）。我们的 `call(..., signal)` 对应 cooperative。
- **断路器**：连续 3 次基础设施失败（启动失败/意外退出/协议错误）→ `PROCESS_CIRCUIT_OPEN` 快速失败；任何一次正常 terminal 归零。handler 抛错不算基础设施失败反而归零——**「子进程崩溃后自动重拉起 vs 反复失败要停」的策略矩阵**，比 M0 现在的「启动期失败不重启、运行期失败立即重启」多一层防循环崩溃。
- **有界流**（stream-data/credit/end/end-ack + 字节/帧数上限）：解决"生成端比消费端快"的背压，我们做 token 流时可以不要（delta 很小），但**出图队列的图字节流如果将来走 MessagePort 要考虑**，不过我们走 novelive:// 协议读文件，天然规避。
- **退出语义**：ready 前退出 = `PROCESS_START_FAILED`（计入断路器）；ready 后未请求退出 = `PROCESS_EXITED{intentional:false}`（计入）；请求的退出 = intentional:true（不计入）；handler 抛错 = `PROCESS_REMOTE_ERROR`（归零断路器）。`child-process-gone` 只作诊断，wrapper 的 `exit` 是唯一状态源——**和 M0「发过 ready 的退出才重启」同款逻辑，但多了崩溃循环防护**。
- **子进程 uncaught exception**：abort 所有 handler 后 exit(73)，绝不发 terminal——崩溃中的 handler 不能伪装成完成。

### YN-translation-workshop：pi 跑在 main + worker_threads（MIT，可拷贝）

与我们相反：pi runtime 在 **main 进程**，CPU 重用 `node:worker_threads` 隔离（`src/main/agent/piNative/translationValidationWorker.ts` 用 `SharedArrayBuffer`+`Atomics.store` 做取消标志；`proofreadPrescanWorker.ts`、`sessionIndexWorker.ts`、`sessionHostReplayWorker.ts` 同理）。worker 取消两层：外部 `worker.terminate()` + 内部 Atomics 标志定期检查。

**对我们的映射**：我们选 utilityProcess 是因为 pi 崩溃不能带走 main。YN 的做法证明：如果某个重活只是 CPU 密（校验、索引），worker_thread 比再起进程便宜。我们 utilityProcess 内部也可以用 worker_threads 做放大降噪之外的 CPU 活。`translationValidationService.ts:39-60` 的「runId+workerData+journalPath+progress 消息」包装是可拷的 worker 任务模板。

### Chatbox：LLM 在 renderer，fetch 经 main 转发（GPL，只参考）

LLM 调用跑在**渲染进程**（`src/shared/models/abstract-ai-sdk.ts` 911 行），只有裸 HTTP fetch 通过 main 的 `desktop-direct-request`（`src/main/desktop-direct-request.ts` 120 行）转发以绕 CORS：三通道 `start/read/cancel`，requestId → `{controller, reader}`，**body 流是拉模式**——renderer 逐次 invoke `read` 拿 `Uint8Array`。`cancelOwner(webContents.id)` 在 webContents 销毁时清掉该窗口所有在途请求。

**意义**：我们的流走 MessagePort 事件推送（推模式），chatbox 证明 pull 模式在 Electron 上也可行但代码量不小。我们的设计更简单；他们的可取点是 `cancelOwner`——**窗口销毁时按 owner 批量取消在途请求**。我们的 call() 已有 AbortSignal，preload 侧 webContents 'destroyed' → 批量 abort 需要照抄这个想法。

### 5ire：Bridge 把 ReadableStream reader 代理过 IPC（改良 Apache，参考）

`src/main/internal/bridge.ts`（206 行）+ `bridge-connector.ts`（113 行）：main 侧 service 方法返回 `ReadableStream` 时，bridge 返回 `{$$STREAM_READER_ID}`，renderer 用 `bridge:stream:next::<ns>` invoke 逐个读、`bridge:stream:stop` 取消；`event.sender.once("destroyed")` 时 `reader.cancel()`。服务树用 `namespace::path` 约定自动展开成 `ipc.handle` 通道，shape 对象（`"async"`/`"stream"`）生成类型安全代理。

**意义**：又一种 pull 式流。若我们的事件推送遇到背压问题（极端长输出高频 token delta），这是最简回退方案：把 token delta 聚合成 per-request buffer，UI 拉。但推送+sequence+attach 回放（见 §3）覆盖得更好。

## 2. IPC 流式传输与事件 schema

### Cherry StreamManager：attach/replay 协议（AGPL，只参考但最重要）

`src/shared/ai/transport/stream.ts`（348 行类型定义）+ `src/main/ai/streamManager/AiStreamManager.ts`（2570 行）。流按 **topicId** 存在 main 的 `activeStreams` map 里，与 webContents 无关——窗口关掉、重开、换窗口，流照样跑。

- **`StreamChunkPayload`**：`{topicId, executionId?, attemptId?, sequence, firstSequence?, anchorMessageId?, chunk}`。每个 execution 内 sequence 单调；chunk 是 AI SDK `UIMessageChunk`。
- **`attach(topicId)` 返回** `{status:'attached', bufferedChunks, replayThrough, replayFrom}` 或 `{status:'done'|'paused'|'error', finalMessages}`。重连时把每个 execution 的环形缓冲做 **compact replay**：相邻 text/reasoning delta 合并（`buildCompactReplay.ts`，单 payload 限 `maxDeltaBytes: 16_384`，`splitDeltaPayload` 保证 coalesced delta 不跨回放截点），渲染端用 `replayThrough[attemptId]` 水位线检测缺口（buffer overflow 丢帧时 warn + droppedChunks 计数）。
- **双层状态广播**：topic 级 `TopicStreamStatus`（pending/streaming/done/aborted/awaiting-approval/error）走 SharedCache 推给所有窗口（侧栏、备份闸门订阅），chunk 级只推 attach 过的 listener——**粗粒度状态与细粒度 token 流分通道**。
- **`stream.listeners` + `WebContentsListener`**：listener 按 `wc:<senderId>:<topicId>` 注册，sender 销毁自动清。
- **UTF-8 安全切分**：`buildCompactReplay.ts` 按码点算字节数切分大 delta——小但容易写错的细节。

**YN 的对照方案**（MIT，`src/main/agent/piNative/sessionService.ts`）：`PiSessionEventEnvelope{workspaceDir, sessionId, sequence, timestamp, event}`，内存保留最近 500 条 envelope，`agent-session:events {afterSequence}` 让渲染端 catch-up；另有 `PiSessionRunState` 快照（running/phase/streamingMessage/queues/contextUsage）+ `agent-session:update` 广播——**和 Cherry 同构的双层（事件流+状态快照），YN 的实现量只有 Cherry 的零头，是我们该抄的复杂度档位**。

### 建议的 IPC 事件 schema（吸收 Cherry 水位线 + YN envelope + 我们的 contract 分层）

命令侧不变（`call(command, payload)`，响应 `{ok:true,data}|{ok:false,code,message}`）。事件侧统一 envelope：

```ts
interface NoveliveEvent {
  seq: number;            // 每个 (projectId, session/run) 单调
  scope: 'app' | 'project' | 'run' | 'session';
  scopeId: string;        // projectId / runId / sessionId
  at: number;             // Date.now()
  event: ContractEvent;   // pi-schema 判别联合
}
```

- `ContractEvent` 按 scope 分：`creator.ready/down`（app，主进程代发 down，带 `generation`）、`run.progress/step`（制作面板）、`session.delta`（对话面板 token 流：`{kind:'text'|'reasoning'|'tool-start'|'tool-end'|'status', ...}`）、`job.state`（出图队列每张图）。
- **catch-up**：`call('events.list', {scope, scopeId, afterSeq})` 返回遗漏 envelope + `{snapshot}`——YN 模式。token 级 delta 只保留每 run 最近 N 条（内存 ring），溢出时响应带 `gap:true` + 最新快照，UI 整体刷新该消息（Cherry 的 `replayThrough`+dropped 检测简化为布尔 gap——我们单执行非多模型，不需要 per-attempt 表）。
- **主进程只转发生命周期**：`creator.ready/down` 带 generation；内容事件界面↔创作端直连不经过主进程（既定）。Cherry 证明「主进程持有流、窗口只是 listener」对"窗口关闭不中断"是正确抽象——我们的 utilityProcess 等价物成立。
- **每帧带 generation**：`{gen: n}` 由主进程在 fork 时分配注入 env/握手消息，事件帧都盖上；重连后 UI 丢弃 `gen` 不匹配的事件。来自 Cherry 协议，成本一行字段。

## 3. SQLite 与数据存储

| 项目 | 选择 | 备注 |
|---|---|---|
| chatbox | renderer IndexedDB（dexie 级）+ main 侧按需 SQLite | 聊天库在渲染层，main 只做文件迁移 |
| cherry-studio | **better-sqlite3@13 + drizzle-orm** + drizzle-kit 迁移 + sqlite-vec | 需 `electron-rebuild` 重编原生模块（package.json:96 `rebuild:electron`） |
| 5ire | better-sqlite3 + drizzle + `drizzle.config.ts` 迁移 | 同样原生模块 |
| YN | 自写 JSONL（header+transaction 行，torn-tail 检测，sidecar 索引） | 无原生依赖 |
| anything-llm | prisma + sqlite | 服务器模式 |
| jan | sqlx/sqlite（Rust） | — |

**关键证据**：Cherry 和 5ire 是仅有的两个在 Electron 里用 better-sqlite3 的大体量项目，**都付出了 `electron-rebuild` 原生模块链**（Cherry `rebuild:electron` script + CI 里按平台 rebuild）。我们 `node:sqlite` 已实测在 Electron 45.4.1 utility process 可用（M0 spike 已过）——**维持了正确的选择，零原生依赖**。证据：没有任何主流 Electron agent 应用用 node:sqlite（因为他们启动早于 Node 24 内置），不代表不行，只代表我们是第一批。

**Cherry 的迁移教训可抄**（`src/main/data/db/applyMigrations.ts`，58 行，AGPL 但思路可写）：drizzle 表重建迁移时 `PRAGMA foreign_keys=OFF` 必须在 migrator 事务**外面**执行（pragma 在事务内是 no-op），迁移后跑 `PRAGMA foreign_key_check` 只记日志不阻塞启动。我们不用 drizzle，但**若自写迁移脚本涉及表重建，同款坑要先知道**：Novelive 的迁移建议就是「PRAGMA user_version + 逐版本 SQL 语句数组 + 事务包裹 + 迁移后 foreign_key_check」，50 行以内，别引 ORM。

**YN atomicFile.ts（MIT，186 行，可直接拷）**：`writeTextFileAtomically`（tmp+rename，Windows 下 EPERM/EACCES/EBUSY 5s 内按 `[0,1,0,2,1,3]ms` 退避重试——Windows 杀软/索引器锁文件的实测坑）+ `writeTextFilesTransaction`（多文件 stage→backup→commit→失败回滚备份）。我们的 config.json 原子写（M0 已写 tmp+rename）建议直接换成这份实现拿 Windows 重试；工程里多文件事务（导出作品包、剧本落盘）也复用它。

## 4. 崩溃恢复 / 后台任务 / 窗口关闭

- **Cherry**：流存活于 main 的 map，窗口全关流继续；新窗口 `attach` 回放。**我们对应**：创作端 utilityProcess 持有制作/出图/会话 run，UI 只挂事件订阅。缺口见 §7。
- **Chatbox 关窗保护**（GPL，参考）：`task-operation:set-active` 由 renderer 在有运行中任务时置 `taskCloseProtected`；`close` 事件拦下并 `send('task-operation:close-requested')` 让 renderer 弹确认，确认后 `task-operation:finish-close {confirmed}` 继续关（main.ts:611,1237-1258）。**我们有「立即停止」和制作中状态，关窗时若作品在制作，这套三步握手可抄：主进程拦 close→界面弹确认→确认后放行**。成本 40 行。
- **YN**：进程退出时把 running subagent 卡片在冷启动标 `stopped{recoveryReason:process_restart}`（`interruptSubagentCards`）——**我们 project.db 的 run 表需要同款：冷启动把 `status='running' AND owner_pid` 已死的行标 `interrupted`**（agent-orchestration 已有 run ledger 计划，此处补 owner_pid 回收细节）。
- **Goose**：后端进程按 windowId lease 管理，窗口关不杀；`will-quit` 统一 cleanupAll。

## 5. 通知 / 托盘 / 全局快捷键

- **Goose** `ipcMain.on('notify')`：renderer 直接发 `{title, body}`，main 侧校验类型、长度 ≤1000、`replace(/<[^>]*>/g,'')` 剥 HTML，`notification.on('click')` 聚焦来源窗口（main.ts:2846-2889）。自动更新完成也用 `new Notification` 弹「点击安装」（utils/autoUpdater.ts:654）。**注意他们把字符串剥 HTML——我们的通知文本来自模型输出（章节完成），同款清洗要抄**。
- **LobeHub**：safeStorage 加密 token、electron-store 配置、多窗口主题同步（README 证据，自定义许可只参考）。
- **Goose wakelock**：`powerSaveBlocker` 按 windowId 管理，窗口 closed/will-quit 时逐个 stop（main.ts:1448-1470, 2104-2135）。**长任务防休眠：M1b 制作跑一晚，powerSaveBlocker 该加进我们的宿主**——一行 API 但很容忘记，记入缺口。

## 6. API Key 与配置存储

- **5ire** `src/main/services/encryptor.ts`（80 行）：AES-256-CBC，key = `sha256(env.cryptoSecret + userKey)`，`cryptoSecret` 编译进包。**和我们「固定密钥写程序里简单加密」是完全同一个方案，连算法都一样**——验证既定设计，可对照实现但自写即可。
- **YN**：provider-config.json 存明文 key，但 **IPC 边界统一脱敏**：返回前 `redactProviderConfig` 把 key 换成 `••••••••`；保存时 incoming key 含 `••••` 就保留旧值（agentProviderHandlers.ts:78-117）。**直接拷这个协议**：界面永远拿不到真 key，「输入框留空=不改」用掩码哨兵实现而不是字段省略——M0 设置页的 API Key 框应该这样做（现在是 config.get 直接返全文，界面持有 key，改进点）。
- **LobeHub**：`safeStorage.encryptString` 存 token（OS keychain 级别）。我们决定不用 safeStorage（备份迁移优先，固定密钥够用）——方向不同但注意 safeStorage 在 Linux 上 fallback 到基本文本，跨机迁移 key 会解不开，印证我们不用的理由。
- **Cherry** `utils/aes.ts`：AES-256-CBC 同款。

## 7. 自动更新 / 日志 / 测试基建

- **Goose**：`electron-updater` + 自建 `githubUpdater` fallback（installer 安装的版本不能走目录 swap fallback）；update-downloaded 弹原生通知点击即 `quitAndInstall`；进度百分比单调上报防回跳（lastReportedProgress）。`electron-log` transports.file → `userData/logs/main.log`，packaged 时 file=info/console=off（utils/logger.ts 12 行——**照抄**）。
- **M0 缺口对照**：我们 CI 已排 M5 自动更新（GitHub Releases），goose 的「通知点击安装」「进度单调」两个细节直接进 M5 规格。
- **Cherry `handleGuarded`**：每个 legacy ipcMain.handle 包 `assertTrustedSender`（校验 `event.senderFrame.url` 是我们自己的 renderer），拒绝 MiniApp/远端 URL 发来的 IPC。**我们 contextBridge + 单窗口无远程内容时风险低，但 dev-bridge 的 WebSocket 端同样要校验来源**——记入缺口。
- **Playwright e2e**：goose `test-e2e` 用 playwright 跑真实 Electron——与我们 M0 `test:e2e` 同路。

## 8. MCP 集成形态（供将来，本期不做）

- **Chatbox**（GPL）：main 持有 `StdioClientTransport`，经 `mcp:stdio-transport:{id}:onmessage` IPC 通道把 JSON-RPC 帧双向转发给 renderer 的 MCP Client 实例（`src/main/mcp/ipc-stdio-transport.ts` 107 行）——**MCP client 在 renderer、stdio 在 main 的奇葩分层，别学；但它证明 MCP SDK 的 Transport 接口可以架在任何消息通道上**。
- **5ire**：MCP client 在 main 进程，`mcp.json` 配置存 userData，`getDefaultEnvironment` 白名单 env 遗传子进程（防 `()` 函数注入——sudo 同款列表）；lazy `import()` SDK 三个 transport。
- **我们的映射**：若将来给主控开 MCP 工具，client 放**创作端**进程，白名单 env 抄 5ire 那张表。

## 9. 排名前 15 的可拿项

| # | 项目/位置 | 拿什么 | 落点 | 判定 |
|---|---|---|---|---|
| 1 | cherry-studio `core/utilityProcess/` + protocol 文档 | generation 帧身份、cooperative/terminate 取消、断路器(3 连失败→open)、ready 前后退出分类 | `apps/desktop` utilityProcess 管理 + `creator/contract` | **只参考**（AGPL）：协议状态机照着重写，文档 `utility-process-protocol.md` 直接当设计蓝本 |
| 2 | cherry `AiStreamManager` + `transport/stream.ts` | attach/topicId 与窗口解耦、`{seq,firstSequence}` chunk 水位线、compact replay(16KB 合并)、粗/细粒度双层广播 | `contract` 事件 schema + creator 事件 ring buffer | **只参考**（AGPL）：设计照抄、代码自写 |
| 3 | YN `piSessionContract` + `sessionService.ts` envelope | `{sessionId, sequence, timestamp, event}` envelope + ring 500 + `events(afterSequence)` + `runState` 快照 | `contract` 事件 + creator session 服务 | **移植改写**（MIT）：模式直接搬，类型换成我们的 pi-schema |
| 4 | goose `gooseServe.ts` | 随机 secret + `redactedXxx` 日志分离、stderr 致命正则提前失败、30s 就绪轮询、SIGTERM→5s→SIGKILL、诊断 JSON 落 logs/ | `apps/desktop` creator 进程管理器 | **移植改写**（Apache）：spawn 换成 utilityProcess.fork，探测换成 ready 帧 |
| 5 | YN `atomicFile.ts` | tmp+rename + Windows EPERM/EBUSY 5s 退避重试 + 多文件事务回滚 | `packages/creator` config/导出写盘 | **直接拷贝**（MIT，署 NOTICE）：186 行零依赖 |
| 6 | YN `agentProviderHandlers` key 掩码 | `••••••••` 哨兵：返回全脱敏、含哨兵的保存保留旧值 | `contract` config.get/update + 设置页 | **移植改写**：config.get 永远不回传明文 key |
| 7 | 5ire `bridge.ts` + `emitter.ts` | `$$STREAM_READER_ID` pull 流兜底 + `sender.once('destroyed')` 清理 reader | 若推送流背压出问题时的备用传输 | **只参考**（改良 Apache）：自写同形，~100 行 |
| 8 | chatbox `desktop-direct-request.ts` | `cancelOwner(webContents.id)`：窗口销毁批量取消在途请求 | preload `window.novelive` | **只参考**（GPL）：在 preload 侧维护 call→AbortController map，destroyed 时全 abort |
| 9 | chatbox `task-operation` 关窗握手 | `set-active`→拦 close→确认卡→`finish-close` | `apps/desktop` 制作中关窗保护（M1b） | **只参考**（GPL）：三步握手 40 行自写 |
| 10 | goose `utils/logger.ts` | electron-log → `userData/logs/main.log`，packaged file=info console=off | `apps/desktop` 主进程 + creator 日志 | **直接拷贝思路**（Apache）：12 行，顺手统一 creator 日志格式 |
| 11 | YN worker 模板 `translationValidationService.ts` | runId+workerData+progress message+terminate/Atomics 双层取消 | creator 内 CPU 重活（索引/校验）如需 worker_threads | **移植改写**（MIT） |
| 12 | cherry `applyMigrations.ts` 教训 | 表重建迁移时 `PRAGMA foreign_keys=OFF` 必须在事务外；迁移后 `foreign_key_check` 只告警 | `packages/creator` project.db 迁移器 | **只参考**（AGPL）：写进迁移器注释 |
| 13 | goose `powerSaveBlocker` 按 windowId 管理 | 制作长跑防系统休眠 | `apps/desktop` M1b | **移植改写**：windowIds set + closed/will-quit 清理 |
| 14 | goose `ipcMain.on('notify')` 输入卫生 | title/body 类型+长度校验+剥 HTML 再 Notification | `apps/desktop` 通知 IPC（章节完成/确认点提醒） | **移植改写** |
| 15 | 5ire `mcp.ts` env 白名单 | MCP 子进程只遗传安全 env（含 `()` 函数过滤） | M5+ 若加 MCP | **只参考**（改良 Apache） |

## 10. 和我们现有设计冲突或缺口

1. **config.get 回传明文 key**（M0 已定）。缺口：YN 证明「永远不回传、哨兵掩码保留旧值」是桌面 agent 应用的成熟做法，且实现成本<50 行。建议：`config.get` 返回 `apiKeyMasked`（非空即 `••••`），`config.update` 里 key 值等于掩码哨兵或空串时保留旧值。收益：截图/日志/前端 state 永不泄露 key。
2. **事件帧没有 generation/防迟到帧机制**（M0 只定「重连后旧请求结果不再生效」）。Cherry 的 `{protocol, version, processId, generation}` 四元组是最小实现：fork 时主进程发 `connect` 帧（带 generation）并把端口转给创作端，事件帧盖 generation。成本一行字段+一层握手。
3. **崩溃重启无断路器**（M0：ready 后退出→立即重启）。Cherry：3 连基础设施失败 → circuit open 转横幅+手动重试；handler 错误反而归零。建议采纳，防止「启动就崩但过了 ready」的死循环反复拉起。
4. **窗口关闭时无制作保护**（规格未写）。chatbox 三步握手（main 拦 close→renderer 确认→finish-close）。M1b 制作面板上线时需要；M0 可不加。
5. **无 catch-up 机制**（M0 只有推送事件）。YN/Cherry 一致结论：任何推送流必须配 `events.list(afterSeq)`+快照补漏，否则窗口重开/主进程转发丢帧后 UI 永久不一致。contract 加 `events.list` 命令。
6. **powerSaveBlocker 缺失**。制作/出图长跑数小时，笔记本合盖/系统休眠会断。宿主按「有活跃 run」启停 `powerSaveBlocker`，`will-quit` 清理。建议写进 M1b 规格。
7. **迁移器注意**：Cherry 实测 SQLite 表重建时 `PRAGMA foreign_keys` 在事务外切，迁移后 `foreign_key_check` 告警不阻塞。project.db 迁移器（M1a）照此写。
8. **utilityProcess stdio**：cherry fork 用 `stdio:'pipe'` 收子进程 stdout/stderr 进日志；M0 规格已写各自写日志文件——建议 creator 的 console.error 也经 port `log` 帧（Cherry 的 LogFrame）汇聚到主进程转 electron-log，单一日志文件比两个文件好排查。
9. **webContents.destroyed 批量取消**：preload 维护 requestId→AbortController map，frame destroyed 时全 abort（chatbox `cancelOwner` 同款）。M0 preload 加 10 行。
10. **不冲突但值得确认**：YN 把 pi 跑 main 进程省了跨进程流，代价是 pi 崩=app 崩（他们用 worker_threads 补 CPU 隔离）。我们 utilityProcess 选型正确性被 Cherry（同选型+完整框架）和 goose（sidecar+lease）双重印证。
11. **MCP 不在范围**：5ire/chatbox 都证明 MCP client 放非渲染进程、stdio 子进程 env 白名单。将来加 MCP 时 client 放 creator 进程即可，无架构障碍。

## 附：未深入项目的原因

- **jan**：Tauri+Rust，进程模型完全不同；MCP/model 管理在 Rust 侧，参考价值低。
- **anything-llm**：桌面端是 Electron 壳 + Express 服务器（`yarn dev:server` 起 3001 端口），不是嵌 agent 的架构参考。
- **LobeHub desktop**：自定义社区许可+Next.js web 核心套壳，IPC 层是 IoC 装饰器方案，与我们的 contract 分层不同，只留了 safeStorage+electron-updater 两个事实点。
- **Msty**：闭源，无源码可读。
- **Claude Desktop 类 MCP host**：闭源；开源 MCP host 已含在 chatbox/5ire/goose(goose 本身是最大 MCP 消费方)。
