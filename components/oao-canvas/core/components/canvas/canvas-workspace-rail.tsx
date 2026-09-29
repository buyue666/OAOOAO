import { History, Home, Image as ImageIcon, Layers3, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { canvasThemes } from "@/components/oao-canvas/core/lib/canvas-theme";
import { useThemeStore } from "@/components/oao-canvas/core/stores/use-theme-store";
import type { CanvasSidePanelTab } from "./canvas-side-panel";

type Props = {
    panelOpen: boolean;
    activeTab: CanvasSidePanelTab;
    onHome: () => void;
    onProjects: () => void;
    onOpenTab: (tab: CanvasSidePanelTab) => void;
    onTogglePanel: () => void;
};

export function CanvasWorkspaceRail({ panelOpen, activeTab, onHome, onProjects, onOpenTab, onTogglePanel }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <aside className="canvas-workspace-rail oao-canvas-rail-index" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }} data-canvas-no-zoom>
            <div className="canvas-workspace-rail-main">
                <RailButton label="主页" icon={<Home className="size-4.5" />} onClick={onHome} theme={theme} />
                <div className="canvas-workspace-rail-divider" style={{ background: theme.toolbar.border }} />
                <RailButton label="节点" icon={<Layers3 className="size-4.5" />} active={panelOpen && activeTab === "canvas"} onClick={() => onOpenTab("canvas")} theme={theme} />
                <RailButton label="资产" icon={<ImageIcon className="size-4.5" />} active={panelOpen && activeTab === "assets"} onClick={() => onOpenTab("assets")} theme={theme} />
                <RailButton label="画布列表" icon={<History className="size-4.5" />} onClick={onProjects} theme={theme} />
            </div>
            <button type="button" className="canvas-workspace-rail-toggle oao-canvas-rail-toggle" style={{ color: theme.toolbar.item }} onClick={onTogglePanel} aria-label={panelOpen ? "收起工作区面板" : "展开工作区面板"} title={panelOpen ? "收起工作区面板" : "展开工作区面板"}>
                {panelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                <span>展开</span>
            </button>
        </aside>
    );
}

function RailButton({ label, icon, active = false, onClick, theme }: { label: string; icon: React.ReactNode; active?: boolean; onClick: () => void; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <button type="button" className={`canvas-workspace-rail-button oao-canvas-rail-index-button ${active ? "is-active" : ""}`} style={{ color: active ? theme.toolbar.activeText : theme.toolbar.item, background: active ? theme.toolbar.activeBg : "transparent" }} onClick={onClick} title={label} aria-label={label} aria-pressed={active}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
