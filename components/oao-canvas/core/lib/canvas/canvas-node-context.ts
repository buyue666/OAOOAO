import type { CanvasTheme } from "@/components/oao-canvas/core/lib/canvas-theme";
import type { CanvasNodeData } from "@/components/oao-canvas/core/types/canvas";
import type { CanvasNodeContext, CanvasNodeHost } from "@/components/oao-canvas/core/types/canvas-node-definition";

// Assemble OAO host capabilities, node data, theme, and scale for a bundled node.
export function buildNodeContext(host: CanvasNodeHost, node: CanvasNodeData, theme: CanvasTheme, scale: number, isSelected = false): CanvasNodeContext {
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
        ai: host.ai,
        openPanel: () => host.openPanel(node.id),
        closePanel: () => host.closePanel(),
    };
}
