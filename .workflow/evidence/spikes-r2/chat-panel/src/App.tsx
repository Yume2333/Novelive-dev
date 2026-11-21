import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  useAuiState,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  BranchPickerPrimitive,
  ActionBarPrimitive,
  type ThreadMessageLike,
  type AppendMessage,
  type ExternalStoreAdapter,
} from "@assistant-ui/react";
import { Streamdown } from "streamdown";
import { FakeCreatorBackend, type Msg } from "./fakeBackend";
import { fromThreadMessageLike } from "@assistant-ui/react";
import "streamdown/styles.css";

const backend = new FakeCreatorBackend();

// ---- projection: backend transcript tree -> assistant-ui repo + visible path
function useBackendSnapshot() {
  return useSyncExternalStore(backend.subscribe, backend.getState);
}

function AssistantParts() {
  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        if (part.type === "text") return <Streamdown>{part.text}</Streamdown>;
        if (part.type === "reasoning")
          return (
            <details className="nl-reasoning" data-testid="reasoning">
              <summary>思考过程</summary>
              <div className="nl-reasoning-body">{part.text}</div>
            </details>
          );
        if (part.type === "tool-call") {
          if (part.toolName.startsWith("propose_"))
            return <ProposalCard part={part} />;
          return <ToolCard part={part} />;
        }
        return null;
      }}
    </MessagePrimitive.Parts>
  );
}

function ToolCard({ part }: { part: any }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="nl-tool-card" data-testid={`tool-${part.toolName}`}>
      <button type="button" onClick={() => setOpen(!open)}>
        工具 {part.toolName} {part.result !== undefined ? "✓" : "…"}
      </button>
      {open && (
        <pre data-testid="tool-args">
          args: {part.argsText}
          {"\n"}result: {JSON.stringify(part.result)}
        </pre>
      )}
    </div>
  );
}

/** 确认卡: approve / reject(+reason) via runtime respondToToolApproval. */
function ProposalCard({ part }: { part: any }) {
  const approval = part.approval;
  const [reason, setReason] = useState("");
  const resolved = approval?.approved !== undefined;
  return (
    <div className="nl-proposal" data-testid="proposal-card">
      <div className="nl-proposal-title">确认提议：{part.toolName.replace("propose_", "")}</div>
      <div className="nl-proposal-prompt">{approval?.prompt}</div>
      <pre className="nl-proposal-args">{part.argsText}</pre>
      {approval && !resolved && (
        <div className="nl-proposal-actions">
          <button data-testid="approve" type="button"
            onClick={() => backend.respondToApproval(approval.id, true)}>确认</button>
          <input
            data-testid="reject-reason"
            placeholder="拒绝理由（可选）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button data-testid="reject" type="button"
            onClick={() => backend.respondToApproval(approval.id, false, reason || undefined)}>
            拒绝
          </button>
        </div>
      )}
      {resolved && (
        <div data-testid="proposal-result" className="nl-proposal-result">
          {approval.approved ? "已确认" : `已拒绝${approval.reason ? `：${approval.reason}` : ""}`}
        </div>
      )}
      {!resolved && part.result !== undefined && <div>{String(part.result)}</div>}
    </div>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="nl-msg nl-assistant">
      <AssistantParts />
      <div className="nl-msg-footer">
        <BranchPickerPrimitive.Root hideWhenSingleBranch className="nl-branch">
          <BranchPickerPrimitive.Previous data-testid="branch-prev" />
          <BranchPickerPrimitive.Number />/<BranchPickerPrimitive.Count />
          <BranchPickerPrimitive.Next data-testid="branch-next" />
        </BranchPickerPrimitive.Root>
        <ActionBarPrimitive.Root hideWhenRunning className="nl-actions">
          <ActionBarPrimitive.Reload data-testid="reload" />
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  if (isEditing)
    return (
      <MessagePrimitive.Root className="nl-msg nl-user" data-testid="edit-composer">
        <ComposerPrimitive.Root className="nl-edit">
          <ComposerPrimitive.Input asChild={false} />
          <ComposerPrimitive.Send>更新并重发</ComposerPrimitive.Send>
          <ComposerPrimitive.Cancel>取消</ComposerPrimitive.Cancel>
        </ComposerPrimitive.Root>
      </MessagePrimitive.Root>
    );
  return (
    <MessagePrimitive.Root className="nl-msg nl-user">
      <MessagePrimitive.Parts />
      <div className="nl-msg-footer">
        <BranchPickerPrimitive.Root hideWhenSingleBranch className="nl-branch">
          <BranchPickerPrimitive.Previous data-testid="branch-prev" />
          <BranchPickerPrimitive.Number />/<BranchPickerPrimitive.Count />
          <BranchPickerPrimitive.Next data-testid="branch-next" />
        </BranchPickerPrimitive.Root>
        <ActionBarPrimitive.Root hideWhenRunning className="nl-actions">
          <ActionBarPrimitive.Edit data-testid="edit" />
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

function ThreadMessage() {
  const role = useAuiState((s) => s.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage />;
}

function Panel() {
  const snap = useBackendSnapshot();

  const messages = useMemo(() => backend.visibleMessages(), [snap.items, snap.headId]);

  const store = useMemo<ExternalStoreAdapter<Msg>>(() => {
    return {
      messages,
      convertMessage: (m) => fromThreadMessageLike(m as unknown as ThreadMessageLike, m.id, { type: "complete", reason: "stop" }) as unknown as Msg,
      isRunning: snap.isRunning,
      // the backend owns the tree: export full repository so branching works
      messageRepository: {
        headId: snap.headId,
        messages: snap.items.map((it) => ({
          message: fromThreadMessageLike(
            it.message as unknown as ThreadMessageLike,
            it.message.id,
            it.message.status ?? { type: "complete", reason: "stop" },
          ) as any,
          parentId: it.parentId,
        })),
      },
      setMessages: () => {
        // store-driven; nothing to write back (required for branch switching)
      },
      unstable_onBranchChange: ({ headId }) => {
        if (headId) backend.switchBranch(headId);
      },
      onNew: async (message: AppendMessage) => {
        const text = message.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        await backend.send(text, snap.headId);
      },
      onEdit: async (message: AppendMessage) => {
        const text = message.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        // sourceId = message being edited; new node becomes sibling (branch)
        await backend.send(text, message.sourceId);
      },
      onReload: async () => {
        // regenerate last assistant reply: re-send its parent's text as a sibling
        const items = snap.items;
        const head = snap.headId;
        const headItem = items.find((i) => i.message.id === head);
        if (headItem?.message.role === "assistant" && headItem.parentId) {
          const parent = items.find((i) => i.message.id === headItem.parentId);
          const text = (parent?.message.content[0] as any)?.text ?? "";
          await backend.send(text, parent ? items.find((i) => i.message.id === parent.message.id)!.parentId : null);
        }
      },
      onCancel: async () => backend.cancel(),
    };
  }, [messages, snap]);

  const runtime = useExternalStoreRuntime(store);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="nl-panel">
        <ThreadPrimitive.Root className="nl-thread">
          <ThreadPrimitive.Viewport data-testid="viewport">
            <ThreadPrimitive.Empty>
              <div data-testid="empty">向 Novelive Agent 提问或下达调整…</div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root className="nl-composer">
            <ComposerPrimitive.Input data-testid="composer" placeholder="给 Agent 的消息…" />
            <ComposerPrimitive.Send data-testid="send">发送</ComposerPrimitive.Send>
            <ComposerPrimitive.Cancel data-testid="stop">停止</ComposerPrimitive.Cancel>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}

export default function App() {
  return <Panel />;
}
