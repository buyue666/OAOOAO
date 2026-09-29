import i18n from "@/components/oao-canvas/core/i18n";
import type { OaoCanvasAction, OaoCanvasDocument } from "@/components/oao-canvas/core/lib/canvas/oao-document-model";
import { applyOaoCanvasActions } from "@/components/oao-canvas/core/lib/canvas/oao-document-model";

/** Compatibility name for the canvas bridge. The document model itself is OAO-owned. */
export type CanvasAgentOp = OaoCanvasAction;
export type CanvasAgentSnapshot = OaoCanvasDocument;

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    return applyOaoCanvasActions(snapshot, Array.isArray(ops) ? ops.filter((op) => op?.type) : []);
}

function opLabel(type: string) {
    return i18n.t(`canvas.agentOps.${type}`, { defaultValue: type });
}
