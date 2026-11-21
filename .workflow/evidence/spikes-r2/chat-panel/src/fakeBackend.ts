// ---------------------------------------------------------------------------
// Fake backend simulating the Novelive creator process (pi-agent-core driven
// 主控 Agent). Emits a transcript-shaped store (EntryId/parentId tree) that the
// renderer projects to assistant-ui messages — same shape as the real
// MessagePort bridge would produce after mapping AgentEvents.
// ---------------------------------------------------------------------------

export type Part =
  | { type: "text"; text: string; parentId?: string }
  | { type: "reasoning"; text: string; parentId?: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      argsText: string;
      result?: unknown;
      isError?: boolean;
      isPreliminary?: boolean;
      parentId?: string;
      approval?: {
        id: string;
        prompt?: string;
        approved?: boolean;
        reason?: string;
        resolution?: "cancelled" | "expired";
      };
    };

export type Msg = {
  id: string;
  role: "user" | "assistant";
  createdAt: Date;
  content: Part[];
  status?:
    | { type: "running" }
    | { type: "requires-action"; reason: "tool-calls" | "interrupt" }
    | { type: "complete"; reason: "stop" | "unknown" }
    | {
        type: "incomplete";
        reason: "cancelled" | "tool-calls" | "length" | "content-filter" | "other" | "error";
        error?: unknown;
      };
};

export type RepoItem = { message: Msg; parentId: string | null };

export type BackendState = {
  items: RepoItem[]; // full tree (all branches)
  headId: string | null; // currently visible leaf (canonical head)
  isRunning: boolean;
};

export type BackendEvent =
  | { kind: "append"; item: RepoItem }
  | { kind: "update"; id: string; patch: Partial<Msg> }
  | { kind: "patchPart"; id: string; partIndex: number; patch: Partial<Part> }
  | { kind: "setHead"; headId: string | null }
  | { kind: "setRunning"; running: boolean };

type Listener = (s: BackendState) => void;

// Simulated agent: streams CJK text, a reasoning block, a tool call with
// streaming args, then a propose_* confirmation card that parks until the user
// answers (respondToToolApproval), then a closing text.
export class FakeCreatorBackend {
  private state: BackendState = { items: [], headId: null, isRunning: false };
  private listeners = new Set<Listener>();
  private counter = 0;
  private pendingApprovals = new Map<string, (approved: { approved: boolean; reason?: string }) => void>();
  private currentRun: { cancelled: boolean } | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;

  private emit(e: BackendEvent) {
    const s = this.state;
    switch (e.kind) {
      case "append":
        this.state = { ...s, items: [...s.items, e.item], headId: e.item.message.id };
        break;
      case "update":
        this.state = {
          ...s,
          items: s.items.map((it) =>
            it.message.id === e.id ? { ...it, message: { ...it.message, ...e.patch } } : it,
          ),
        };
        break;
      case "patchPart":
        this.state = {
          ...s,
          items: s.items.map((it) => {
            if (it.message.id !== e.id) return it;
            const content = it.message.content.map((p, i) =>
              i === e.partIndex ? ({ ...p, ...e.patch } as Part) : p,
            );
            return { ...it, message: { ...it.message, content } };
          }),
        };
        break;
      case "setHead":
        this.state = { ...s, headId: e.headId };
        break;
      case "setRunning":
        this.state = { ...s, isRunning: e.running };
        break;
    }
    this.listeners.forEach((l) => l(this.state));
  }

  private nid(prefix: string) {
    return `${prefix}-${++this.counter}`;
  }

  private sleep(ms: number, run: { cancelled: boolean }) {
    return new Promise<void>((res, rej) => {
      const t = setTimeout(() => (run.cancelled ? rej(new Error("cancelled")) : res()), ms);
      if (ms === 0) clearTimeout(t), run.cancelled ? rej(new Error("cancelled")) : res();
    });
  }

  // ---- commands (what the contract layer would send over MessagePort) ----

  /** chat.send — start a run on a new user message (or an edited one). */
  async send(text: string, parentId: string | null, opts?: { replaceFromId?: string }) {
    if (this.currentRun) return; // single-run like our panel
    const run = { cancelled: false };
    this.currentRun = run;
    try {
      // user message (a new branch node under parentId)
      const uid = this.nid("u");
      this.emit({
        kind: "append",
        item: {
          parentId,
          message: {
            id: uid,
            role: "user",
            createdAt: new Date(),
            content: [{ type: "text", text }],
          },
        },
      });
      this.emit({ kind: "setRunning", running: true });
      const aid = this.nid("a");
      this.emit({
        kind: "append",
        item: {
          parentId: uid,
          message: {
            id: aid,
            role: "assistant",
            createdAt: new Date(),
            content: [],
            status: { type: "running" },
          },
        },
      });

      // turn 1: reasoning stream
      this.patchAppend(aid, { type: "reasoning", text: "" });
      const think = "先看这条消息想让主控做什么：要重做第 3 章。需要确认改动范围，所以先查章节，再出确认卡。";
      for (const ch of chunkText(think, 6)) {
        await this.sleep(30, run);
        this.patchAppendText(aid, 0, ch);
      }

      // turn 1: text stream (markdown with CJK + partial syntax)
      this.patchAppend(aid, { type: "text", text: "" });
      const md =
        "好的，我来安排。**计划如下**：\n\n- 先读第 3 章剧本确认现状\n- 然后提交 `propose_redo_chapter` 确认卡\n\n> 重做会影响已出的 4 张图。\n\n下面是步骤说明，包含一点 `行内代码` 和公式 $x^2$：\n\n```\n代码块示例 行1\n```\n";
      for (const ch of chunkText(md, 5)) {
        await this.sleep(25, run);
        this.patchAppendText(aid, 1, ch);
      }

      // tool call: read_chapter (args stream + execution + result)
      const tc1 = "tc-read";
      this.patchAppend(aid, {
        type: "tool-call",
        toolCallId: tc1,
        toolName: "read_chapter",
        args: {},
        argsText: "",
      });
      const argsFull = '{"chapterId":"ch-003"}';
      for (const ch of chunkText(argsFull, 7)) {
        await this.sleep(40, run);
        this.patchAppendArgsText(aid, 2, ch);
      }
      await this.sleep(350, run); // executing
      this.patchPart(aid, 2, {
        args: { chapterId: "ch-003" },
        result: "第 3 章剧本：共 12 场，已发布。",
      });

      // propose_* tool -> confirmation card (approval) — session parks here
      const proposalId = this.nid("prop");
      this.patchAppend(aid, {
        type: "tool-call",
        toolCallId: "tc-propose",
        toolName: "propose_redo_chapter",
        args: { chapterId: "ch-003", instruction: "加强冲突，结局留白" },
        argsText: '{"chapterId":"ch-003","instruction":"加强冲突，结局留白"}',
        approval: {
          id: proposalId,
          prompt: "重做第 3 章：加强冲突，结局留白。影响：本章 12 场剧本与 4 张已出图片将重画。",
        },
      });
      this.emit({ kind: "update", id: aid, patch: { status: { type: "requires-action", reason: "interrupt" } } });
      this.emit({ kind: "setRunning", running: false }); // parked: slot freed

      const decision = await new Promise<{ approved: boolean; reason?: string }>((res) =>
        this.pendingApprovals.set(proposalId, res),
      );

      // resume: record decision on the card, continue run
      this.patchPart(aid, 3, {
        approval: {
          id: proposalId,
          prompt: "重做第 3 章：加强冲突，结局留白。影响：本章 12 场剧本与 4 张已出图片将重画。",
          approved: decision.approved,
          ...(decision.reason ? { reason: decision.reason } : {}),
        },
        result: decision.approved
          ? "提议已确认：第 3 章已进入制作队列。"
          : `提议被拒绝${decision.reason ? `：${decision.reason}` : "。"}`,
      });
      this.emit({ kind: "update", id: aid, patch: { status: { type: "running" } } });
      this.emit({ kind: "setRunning", running: true });

      // turn 2: closing text
      this.patchAppend(aid, { type: "text", text: "" });
      const closing = decision.approved
        ? "已确认。第 3 章现在排队重做，完成前它会让出制作槽给排队作品。\n\n完成后我会再汇报。"
        : `明白，已记下拒绝${decision.reason ? `原因「${decision.reason}」` : ""}。需要的话我可以调整方案再提一次。`;
      for (const ch of chunkText(closing, 6)) {
        await this.sleep(25, run);
        this.patchAppendText(aid, 4, ch);
      }

      this.emit({ kind: "update", id: aid, patch: { status: { type: "complete", reason: "stop" } } });
      this.emit({ kind: "setRunning", running: false });
    } catch (err) {
      // cancelled mid-run
      const last = this.state.items[this.state.items.length - 1];
      if (last && last.message.role === "assistant") {
        this.emit({
          kind: "update",
          id: last.message.id,
          patch: { status: { type: "incomplete", reason: "cancelled" } },
        });
      }
      this.emit({ kind: "setRunning", running: false });
    } finally {
      this.currentRun = null;
    }
  }

  cancel() {
    if (this.currentRun) this.currentRun.cancelled = true;
    // resolve pending approval as dismissed so the parked run unwinds
    for (const [id, res] of this.pendingApprovals) {
      res({ approved: false, reason: "cancelled" });
      this.pendingApprovals.delete(id);
    }
  }

  respondToApproval(approvalId: string, approved: boolean, reason?: string) {
    const res = this.pendingApprovals.get(approvalId);
    if (res) {
      this.pendingApprovals.delete(approvalId);
      res({ approved, reason });
    }
  }

  switchBranch(headId: string) {
    this.emit({ kind: "setHead", headId });
  }

  /** chat.list visible path helper: walk parents from head. */
  visibleMessages(): Msg[] {
    const byId = new Map(this.state.items.map((i) => [i.message.id, i]));
    const out: Msg[] = [];
    let cur = this.state.headId;
    while (cur) {
      const it = byId.get(cur);
      if (!it) break;
      out.unshift(it.message);
      cur = it.parentId;
    }
    return out;
  }

  // helpers to patch the streaming assistant message
  private patchAppend(msgId: string, part: Part) {
    const it = this.state.items.find((i) => i.message.id === msgId)!;
    this.emit({ kind: "update", id: msgId, patch: { content: [...it.message.content, part] } });
  }
  private patchAppendText(msgId: string, partIndex: number, delta: string) {
    const it = this.state.items.find((i) => i.message.id === msgId)!;
    const part = it.message.content[partIndex] as { text: string };
    this.patchPart(msgId, partIndex, { text: part.text + delta });
  }
  private patchAppendArgsText(msgId: string, partIndex: number, delta: string) {
    const it = this.state.items.find((i) => i.message.id === msgId)!;
    const part = it.message.content[partIndex] as { argsText: string };
    this.patchPart(msgId, partIndex, { argsText: part.argsText + delta });
  }
  private patchPart(msgId: string, partIndex: number, patch: Partial<Part>) {
    this.emit({ kind: "patchPart", id: msgId, partIndex, patch });
  }
}

function chunkText(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}
