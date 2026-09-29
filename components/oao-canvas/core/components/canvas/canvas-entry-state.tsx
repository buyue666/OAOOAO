import { ArrowUpRight, FileText, ImageIcon, Upload, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/components/oao-canvas/core/lib/canvas-theme";
import { useThemeStore } from "@/components/oao-canvas/core/stores/use-theme-store";
import { CanvasNodeType } from "@/components/oao-canvas/core/types/canvas";

type Props = {
    onOpenAgent: () => void;
    onCreateNode: (type: CanvasNodeType) => void;
    onUpload: () => void;
    onDismiss: () => void;
};

export function CanvasEntryState({ onOpenAgent, onCreateNode, onUpload, onDismiss }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="canvas-entry-state" style={{ color: theme.node.text }} data-canvas-no-zoom>
            <div className="canvas-entry-copy">
                <p className="canvas-entry-kicker">{t("canvas.entry.kicker")}</p>
                <h1>
                    {t("canvas.entry.titleLead")}
                    <strong>{t("canvas.entry.titleAccent")}</strong>
                </h1>
                <p className="canvas-entry-description">{t("canvas.entry.description")}</p>
            </div>
            <div className="canvas-entry-play" aria-hidden="true" style={{ color: theme.node.text }}>
                <span />
            </div>
            <div className="canvas-entry-actions">
                <button type="button" className="canvas-entry-primary" style={{ color: theme.node.text }} onClick={onOpenAgent}>
                    <span>{t("canvas.entry.agent")}</span>
                    <ArrowUpRight className="size-4" />
                </button>
                <button type="button" className="canvas-entry-link" onClick={() => { onCreateNode(CanvasNodeType.Image); onDismiss(); }}><ImageIcon className="size-3.5" />{t("canvas.entry.image")}</button>
                <button type="button" className="canvas-entry-link" onClick={() => { onCreateNode(CanvasNodeType.Video); onDismiss(); }}><Video className="size-3.5" />{t("canvas.entry.video")}</button>
            </div>
            <div className="canvas-entry-shortcuts" style={{ borderColor: theme.toolbar.border }}>
                <button type="button" onClick={onUpload}><Upload className="size-3.5" />{t("canvas.entry.import")}</button>
                <button type="button" onClick={() => { onCreateNode(CanvasNodeType.Text); onDismiss(); }}><FileText className="size-3.5" />{t("canvas.entry.text")}</button>
                <button type="button" onClick={onDismiss}>{t("canvas.entry.blank")}</button>
                <span className="canvas-entry-hint">{t("canvas.entry.dropHint")}</span>
            </div>
        </div>
    );
}
