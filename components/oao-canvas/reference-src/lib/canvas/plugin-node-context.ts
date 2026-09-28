import { createPluginStorage, emitCanvasEvent, onCanvasEvent } from "@/components/oao-canvas/reference-src/lib/canvas/canvas-event-bus";
import { getNodePluginId } from "@/components/oao-canvas/reference-src/lib/canvas/node-registry";
import type { CanvasTheme } from "@/components/oao-canvas/reference-src/lib/canvas-theme";
import type { CanvasNodeData } from "@/components/oao-canvas/reference-src/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/components/oao-canvas/reference-src/types/canvas-plugin";

// Assemble host capabilities, node data, theme, and scale into the context injected into plugin nodes.
export function buildNodeContext(host: CanvasPluginHost, node: CanvasNodeData, theme: CanvasTheme, scale: number, isSelected = false): CanvasNodeContext {
    const storage = createPluginStorage(getNodePluginId(node.type));
    return {
        node,
        theme,
        scale,
        isSelected,
        updateMetadata: (patch) => host.updateMetadata(node.id, patch),
        updateNode: (patch) => host.updateNode(node.id, patch),
        getNode: (id) => host.getNode(id),
        getNodes: () => host.getNodes(),
        getConnections: () => host.getConnections(),
        getUpstream: () => host.getUpstream(node.id),
        getDownstream: () => host.getDownstream(node.id),
        applyOps: (ops) => host.applyOps(ops),
        emit: (event, payload) => emitCanvasEvent(event, payload),
        on: (event, handler) => onCanvasEvent(event, handler),
        ai: host.ai,
        openPanel: () => host.openPanel(node.id),
        closePanel: () => host.closePanel(),
        storage,
    };
}
