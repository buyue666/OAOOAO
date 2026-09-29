import { Button, Dropdown, Tooltip } from "antd";
import {
    Eraser, Hand, Image as ImageIcon, MoreHorizontal, MousePointer2, Plus, Redo2,
    Trash2, Type, Undo2, Upload, Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";

type CanvasToolbarProps = {
    selectedCount: number;
    canvasTool: "select" | "pan";
    canUndo: boolean;
    canRedo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddText: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onCanvasToolChange: (tool: "select" | "pan") => void;
};

export function CanvasToolbar({
    selectedCount, canvasTool, canUndo, canRedo,
    onAddImage, onAddVideo, onAddText,
    onUndo, onRedo, onUpload, onDelete, onClear, onCanvasToolChange,
}: CanvasToolbarProps) {
    const { t } = useTranslation();

    const createItems = [
        { key: "image", icon: <ImageIcon size={16} />, label: t("canvas.toolbar.image"), onClick: onAddImage },
        { key: "video", icon: <Video size={16} />, label: t("canvas.toolbar.video"), onClick: onAddVideo },
        { key: "text", icon: <Type size={16} />, label: t("canvas.toolbar.text"), onClick: onAddText },
    ];

    const moreItems = [
        { key: "tool", icon: canvasTool === "select" ? <MousePointer2 size={16} /> : <Hand size={16} />, label: t(`canvas.toolbar.${canvasTool}`), onClick: () => onCanvasToolChange(canvasTool === "select" ? "pan" : "select") },
        { key: "undo", icon: <Undo2 size={16} />, label: t("canvas.undo"), disabled: !canUndo, onClick: onUndo },
        { key: "redo", icon: <Redo2 size={16} />, label: t("canvas.redo"), disabled: !canRedo, onClick: onRedo },
        { type: "divider" as const },
        ...(selectedCount ? [{ key: "delete", icon: <Trash2 size={16} />, label: t("canvas.deleteSelected"), danger: true, onClick: onDelete }] : []),
        { key: "clear", icon: <Eraser size={16} />, label: t("canvas.toolbar.clear"), danger: true, onClick: onClear },
    ];

    return (
        <div className="oao-canvas-actions" data-canvas-no-zoom>
            <Dropdown menu={{ items: createItems }} trigger={["click"]} overlayClassName="oao-canvas-action-menu" placement="bottomLeft">
                <Button type="primary" icon={<Plus size={16} />} className="oao-canvas-actions-create" aria-label="新建节点">
                    新建节点
                </Button>
            </Dropdown>
            <Tooltip title={t("canvas.toolbar.upload")}>
                <Button type="text" icon={<Upload size={16} />} onClick={onUpload} aria-label={t("canvas.toolbar.upload")} />
            </Tooltip>
            <span className="oao-canvas-actions-divider" />
            <Dropdown menu={{ items: moreItems }} trigger={["click"]} overlayClassName="oao-canvas-action-menu" placement="bottomLeft">
                <Tooltip title="更多操作">
                    <Button type="text" icon={<MoreHorizontal size={17} />} aria-label="更多操作" />
                </Tooltip>
            </Dropdown>
        </div>
    );
}
