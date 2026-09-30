import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, PanelRightClose } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { PlatformAgentPanel } from "./platform-agent-panel";
import { useStudio } from "@/lib/studio/store";
import { canvasThemes } from "@/components/oao-canvas/core/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/components/oao-canvas/core/stores/use-agent-store";
import { useThemeStore } from "@/components/oao-canvas/core/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel({ projectId }: { projectId: string }) {
    const { state } = useStudio();
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useAgentStore((state) => state.width);
    const [resizing, setResizing] = useState(false);
    const [viewportWidth, setViewportWidth] = useState(1440);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    useEffect(() => {
        const updateViewportWidth = () => setViewportWidth(window.innerWidth);
        updateViewportWidth();
        window.addEventListener("resize", updateViewportWidth);
        return () => window.removeEventListener("resize", updateViewportWidth);
    }, []);

    const effectiveWidth = Math.min(width, Math.max(0, viewportWidth - 16));
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(760, Math.max(360, startWidth + startX - moveEvent.clientX));
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className="oao-platform-agent-wrap relative z-[70] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? effectiveWidth + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: panelOpen && !panelClosing ? undefined : "none" }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col border-l"
                data-canvas-shortcuts-ignore
                initial={{ x: 48 }}
                animate={{ x: panelClosing ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width: effectiveWidth, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("agent.panel.resize")} />
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2.5" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                                <Bot className="size-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">OAO Agent</p>
                                <p className="truncate text-[10px]" style={{ color: theme.node.muted }}>{t("agent.platform.subtitle")}</p>
                            </div>
                        </div>
                        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-white/10" style={{ color: theme.node.muted }} onClick={() => useAgentStore.getState().closePanel()} aria-label={t("agent.panel.collapseLabel")} title={t("agent.panel.collapseLabel")}>
                            <PanelRightClose className="size-4" aria-hidden="true" />
                        </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden">
                        <PlatformAgentPanel key={`${state.backendStatus}:${state.user.id}:${projectId}`} projectId={projectId} />
                    </div>
                </div>
            </motion.aside>
        </motion.div>
    );
}
