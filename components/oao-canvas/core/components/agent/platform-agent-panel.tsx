import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, History, Loader2, Pause, Play, Plus, RefreshCw, Send, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useStudio } from "@/lib/studio/store";
import { controlAgentRun, createAgentRun, getAgentRun, listAgentRuns, newClientRequestId, retryAgentRunTask, type CreateAgentRunInput } from "@/lib/studio/generation-api";
import type { AgentRun } from "@/lib/studio/generation-types";
import { canvasThemes } from "@/components/oao-canvas/core/lib/canvas-theme";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/components/oao-canvas/core/lib/canvas/canvas-agent-ops";
import { useAgentStore } from "@/components/oao-canvas/core/stores/use-agent-store";
import { useThemeStore } from "@/components/oao-canvas/core/stores/use-theme-store";

const EVENT_TYPES = ["canvas.ops", "task.running", "task.created", "task.completed", "task.child.completed", "task.child.failed", "task.failed", "task.needs_review", "run.plan.awaiting_approval", "run.plan.approved", "run.completed", "run.failed", "run.cancelled", "run.paused", "run.snapshot"];
const terminal = (run?: AgentRun) => Boolean(run && ["completed", "failed", "cancelled"].includes(run.status));

// Only document updates are accepted. Replayed events must never start a second paid generation.
function applyServerOps(ops: CanvasAgentOp[], projectId: string, applied: Set<string>) {
    const context = useAgentStore.getState().canvasContext;
    if (!context || context.snapshot.projectId !== projectId) return;
    const safe = ops.flatMap((op): CanvasAgentOp[] => {
        if (op.type === "add_node") {
            if (!op.id || applied.has(op.id) || context.snapshot.nodes.some((node) => node.id === op.id)) return [];
            if (!["image", "video", "text", "audio", "task"].includes(op.nodeType || "")) return [];
            applied.add(op.id);
            if (op.nodeType === "task") return [{ ...op, nodeType: "text", metadata: { content: op.title || "", status: "idle" } }];
            return [op];
        }
        if (["update_node", "connect_nodes", "select_nodes"].includes(op.type)) return [op];
        return [];
    });
    if (safe.length) context.applyOps(safe);
}

function requestSnapshot(snapshot: CanvasAgentSnapshot) {
    return {
        projectId: snapshot.projectId, title: snapshot.title, selectedNodeIds: snapshot.selectedNodeIds,
        connections: snapshot.connections,
        nodes: snapshot.nodes.map((node) => ({
            id: node.id, type: node.type, title: node.title, width: node.width, height: node.height,
            metadata: { size: node.metadata?.size, naturalWidth: node.metadata?.naturalWidth, naturalHeight: node.metadata?.naturalHeight,
                content: node.type === "text" ? (node.metadata?.content || node.metadata?.prompt || "").slice(0, 12000) : undefined,
                url: node.type !== "text" && /^(https?:\/\/|\/api\/)/.test(node.metadata?.content || "") ? node.metadata?.content : undefined },
        })),
    };
}

export function PlatformAgentPanel({ projectId }: { projectId: string }) {
    const { t } = useTranslation();
    const { state, liveReady } = useStudio();
    const theme = canvasThemes[useThemeStore((value) => value.theme)];
    const panelOpen = useAgentStore((value) => value.panelOpen);
    const [runs, setRuns] = useState<AgentRun[]>([]);
    const [run, setRun] = useState<AgentRun>();
    const [prompt, setPrompt] = useState("");
    const [mode, setMode] = useState<"text" | "image" | "video">("text");
    const [model, setModel] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [reply, setReply] = useState("");
    const [loading, setLoading] = useState(false);
    const mounted = useRef(true);
    const locked = useRef(false);
    const pending = useRef<{ signature: string; input: CreateAgentRunInput } | undefined>(undefined);
    const applied = useRef(new Set<string>());
    const selectedId = useRef("");
    const models = state.liveModels.filter((item) => item.capability === mode);
    const selectedModel = models.some((item) => item.id === model) ? model : models[0]?.id || "";
    const active = Boolean(run && !terminal(run));
    const style = { "--agent-text": theme.node.text, "--agent-muted": theme.node.muted, "--agent-fill": theme.node.panel, "--agent-line": theme.node.stroke, "--agent-active": theme.toolbar.activeBg } as CSSProperties;
    const updateRun = (value: AgentRun) => {
        setRun(value);
        setRuns((current) => [value, ...current.filter((item) => item.id !== value.id)]);
    };

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        if (!liveReady || !panelOpen) return;
        let disposed = false;
        setLoading(true);
        void listAgentRuns({ surface: "canvas", projectId, limit: 30 }).then(({ data }) => {
            if (disposed) return;
            setRuns(data.runs);
            setRun((current) => current || data.runs[0]);
            setError("");
        }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : t("agent.platform.failed")); })
            .finally(() => { if (!disposed) setLoading(false); });
        return () => { disposed = true; };
    }, [liveReady, panelOpen, projectId, t]);

    useEffect(() => {
        const id = run?.id;
        selectedId.current = id || "";
        setReply("");
        if (!id || !liveReady) return;
        let disposed = false;
        let polling = false;
        const seen = new Set<string>();
        const source = new EventSource(`/api/agent/runs/${encodeURIComponent(id)}/events`);
        const reconcile = async () => {
            if (disposed || polling) return;
            polling = true;
            try {
                const { data } = await getAgentRun(id);
                if (!disposed) updateRun(data.run);
            } catch (reason) {
                if (!disposed) setError(reason instanceof Error ? reason.message : t("agent.platform.failed"));
            } finally { polling = false; }
        };
        for (const eventType of EVENT_TYPES) source.addEventListener(eventType, (event) => {
            if (disposed) return;
            const message = event as MessageEvent<string>;
            try {
                const payload = JSON.parse(message.data) as { id?: string; status?: AgentRun["status"]; data?: { ops?: CanvasAgentOp[]; reply?: string; message?: string } };
                const eventId = message.lastEventId || payload.id;
                if (eventId && seen.has(eventId)) return;
                if (eventId) seen.add(eventId);
                if (Array.isArray(payload.data?.ops)) applyServerOps(payload.data.ops, projectId, applied.current);
                const text = payload.data?.reply || payload.data?.message;
                if (text) setReply(text);
                if (["run.completed", "run.failed", "run.cancelled"].includes(eventType) || (eventType === "run.snapshot" && payload.status && terminal({ status: payload.status } as AgentRun))) source.close();
                void reconcile();
            } catch { setError(t("agent.platform.syncFailed")); }
        });
        source.onerror = () => { void reconcile(); };
        void reconcile();
        const timer = window.setInterval(() => { if (document.visibilityState === "visible") void reconcile(); }, 4000);
        return () => { disposed = true; source.close(); window.clearInterval(timer); };
    }, [run?.id, liveReady, projectId, t]);

    async function send() {
        if (locked.current || !liveReady || active || !prompt.trim()) return;
        const context = useAgentStore.getState().canvasContext;
        if (!context || context.snapshot.projectId !== projectId) { setError(t("agent.platform.notReady")); return; }
        if (mode !== "text" && !selectedModel) { setError(t("agent.platform.noModel")); return; }
        locked.current = true; setBusy(true); setError("");
        const snapshot = requestSnapshot(context.snapshot);
        const signature = JSON.stringify({ prompt: prompt.trim(), mode, model: selectedModel, snapshot });
        if (pending.current?.signature !== signature) pending.current = { signature, input: {
            clientRequestId: newClientRequestId("canvas-agent"), prompt: prompt.trim(), surface: "canvas", projectId, snapshot,
            ...(run?.conversationId ? { conversationId: run.conversationId } : {}),
            ...(mode !== "text" ? { modelIds: [selectedModel], preferences: { mode } } : {}),
        } };
        try {
            const { data } = await createAgentRun(pending.current.input);
            if (!mounted.current) return;
            updateRun(data.run); setPrompt(""); pending.current = undefined; setHistoryOpen(false);
        } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : t("agent.platform.failed")); }
        finally { locked.current = false; if (mounted.current) setBusy(false); }
    }

    async function action(value: "pause" | "resume" | "retry" | "cancel" | "approve", taskId?: string) {
        if (!run || locked.current) return;
        locked.current = true; setBusy(true); setError("");
        const id = run.id;
        try {
            if (taskId) await retryAgentRunTask(id, taskId);
            else {
                // The backend cancels paused/running runs, not an approval stop directly.
                if (value === "cancel" && run.status === "awaiting_approval") await controlAgentRun(id, "pause");
                await controlAgentRun(id, value);
            }
            const { data } = await getAgentRun(id);
            if (mounted.current && selectedId.current === id) updateRun(data.run);
        } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : t("agent.platform.failed")); }
        finally { locked.current = false; if (mounted.current) setBusy(false); }
    }

    return (
        <div className="oao-platform-agent" style={style}>
            <div className="oao-platform-agent-tools">
                <button type="button" aria-pressed={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History size={15} />{t("agent.platform.history")}</button>
                <button type="button" disabled={active || busy} onClick={() => { setRun(undefined); setReply(""); setError(""); pending.current = undefined; }}><Plus size={15} />{t("agent.platform.new")}</button>
            </div>
            <div className="oao-platform-agent-scroll" aria-live="polite">
                {historyOpen && <div className="oao-platform-agent-history">{runs.map((item) => <button type="button" key={item.id} aria-pressed={run?.id === item.id} disabled={busy} onClick={() => { setRun(item); setHistoryOpen(false); }}><span>{item.prompt}</span><small>{t(`agent.platform.status.${item.status}`)}</small></button>)}</div>}
                {!run && <div className="oao-platform-agent-empty"><h2>{t("agent.platform.title")}</h2><p>{t("agent.platform.intro")}</p>{["storyboard", "visual", "motion"].map((key) => <button key={key} type="button" onClick={() => setPrompt(t(`agent.platform.examples.${key}`))}>{t(`agent.platform.examples.${key}`)}<Send size={14} /></button>)}</div>}
                {run && <>
                    <p className="oao-platform-agent-prompt">{run.prompt}</p>
                    <div className="oao-platform-agent-status">{active ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" /> : <Check size={15} />}<span>{t(`agent.platform.status.${run.status}`)}</span><small>{t("agent.platform.cost", { count: run.pointsCost || 0 })}</small></div>
                    {reply && <p className="oao-platform-agent-reply">{reply}</p>}
                    {run.failure && <p role="alert">{run.failure}</p>}
                    <ol className="oao-platform-agent-tasks">{run.tasks.map((task) => <li key={task.id}><strong>{task.title}</strong><span>{t(`agent.platform.taskStatus.${task.status}`, { defaultValue: task.status })}</span>{task.optimizedPrompt && <p>{task.optimizedPrompt}</p>}{task.error && <p role="alert">{task.error}</p>}{["failed", "error"].includes(task.status) && <button type="button" disabled={busy} onClick={() => void action("retry", task.id)}><RefreshCw size={14} />{t("agent.platform.retry")}</button>}</li>)}</ol>
                    {run.status === "awaiting_approval" && run.planApproval && <div className="oao-platform-agent-approval"><strong>{t("agent.platform.approval")}</strong><p>{t("agent.platform.total", { count: run.planApproval.totalPoints })}{run.planApproval.estimated ? ` · ${t("agent.platform.estimated")}` : ""}</p>{run.planApproval.steps.map((step) => <div key={step.id}><span>{step.title}</span><span>{step.estimatedPoints ?? "-"}</span></div>)}<button type="button" disabled={busy} onClick={() => void action("approve")}><Play size={14} />{t("agent.platform.approve")}</button></div>}
                    <div className="oao-platform-agent-controls">
                        {["planning", "running"].includes(run.status) && <button type="button" disabled={busy} onClick={() => void action("pause")}><Pause size={14} />{t("agent.platform.pause")}</button>}
                        {run.status === "paused" && !run.cancellation && <button type="button" disabled={busy} onClick={() => void action("resume")}><Play size={14} />{t("agent.platform.resume")}</button>}
                        {active && <button type="button" disabled={busy} onClick={() => void action("cancel")}><Square size={14} />{t("agent.platform.cancel")}</button>}
                        {run.status === "failed" && !run.tasks.length && <button type="button" disabled={busy} onClick={() => void action("retry")}><RefreshCw size={14} />{t("agent.platform.retry")}</button>}
                    </div>
                    {run.cancellation && <p>{t("agent.platform.cancelling", { count: run.cancellation.pendingCount })}</p>}
                    {run.status === "cancelled" && <p>{t("agent.platform.cancelledHint")}</p>}
                </>}
                {loading && <p className="oao-platform-agent-muted">{t("agent.platform.loading")}</p>}
                {error && <p role="alert" className="oao-platform-agent-error">{error}</p>}
            </div>
            <form className="oao-platform-agent-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
                <div className="oao-platform-agent-modes" role="group" aria-label={t("agent.platform.mode")}>
                    {(["text", "image", "video"] as const).map((item) => <button key={item} type="button" disabled={active || busy} aria-pressed={mode === item} onClick={() => { setMode(item); setModel(""); }}>{t(`agent.platform.modes.${item}`)}</button>)}
                </div>
                {mode !== "text" && <select aria-label={t("agent.platform.model")} disabled={active || busy} value={selectedModel} onChange={(event) => setModel(event.target.value)}>{!models.length && <option value="">{t("agent.platform.noModel")}</option>}{models.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select>}
                <textarea aria-label={t("agent.platform.input")} placeholder={liveReady ? t("agent.platform.placeholder") : t("agent.platform.login")} maxLength={4000} rows={3} value={prompt} disabled={!liveReady || active || busy} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
                <div className="oao-platform-agent-submit"><span>{t("agent.platform.context")}</span><button type="submit" disabled={!liveReady || active || busy || loading || !prompt.trim()} aria-label={t("agent.platform.send")} title={t("agent.platform.send")}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button></div>
            </form>
        </div>
    );
}
