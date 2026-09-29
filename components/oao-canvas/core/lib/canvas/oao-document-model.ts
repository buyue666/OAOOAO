import { nanoid } from "nanoid";

import { getNodeSpec, isRegisteredNodeType } from "@/components/oao-canvas/core/lib/canvas/node-definitions";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type ViewportTransform } from "@/components/oao-canvas/core/types/canvas";

/**
 * OAO's canvas document contract.
 *
 * The editor stores a document and applies small, explicit actions to it. The
 * Agent uses the same actions as the UI, so it cannot invent a second canvas
 * state or mutate React state directly.
 */
export type OaoCanvasDocument = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

export type OaoCanvasAction =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export function applyOaoCanvasActions(document: OaoCanvasDocument, actions: OaoCanvasAction[] = []) {
    let nodes = document.nodes;
    let connections = document.connections;
    let selectedNodeIds = document.selectedNodeIds;
    let viewport = document.viewport;

    actions.forEach((action, index) => {
        switch (action.type) {
            case "add_node": {
                const nodeType = action.nodeType && isRegisteredNodeType(action.nodeType) ? action.nodeType : CanvasNodeType.Text;
                const spec = getNodeSpec(nodeType);
                const id = action.id || `oao-${nodeType}-${nanoid(8)}`;
                const node: CanvasNodeData = {
                    id,
                    type: nodeType,
                    title: action.title || spec.title,
                    position: action.position || { x: action.x ?? index * 36, y: action.y ?? index * 36 },
                    width: action.width || spec.width,
                    height: action.height || spec.height,
                    metadata: { ...spec.metadata, ...action.metadata },
                };
                nodes = [...nodes, node];
                selectedNodeIds = [id];
                break;
            }
            case "update_node":
                nodes = nodes.map((node) => (node.id === action.id ? { ...node, ...action.patch, metadata: { ...node.metadata, ...action.patch?.metadata, ...action.metadata } } : node));
                break;
            case "delete_node": {
                const ids = new Set(action.ids || (action.id ? [action.id] : action.nodeType ? nodes.filter((node) => node.type === action.nodeType).map((node) => node.id) : []));
                nodes = nodes.filter((node) => !ids.has(node.id));
                connections = connections.filter((connection) => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId));
                selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
                break;
            }
            case "delete_connections": {
                const ids = new Set(action.ids || (action.id ? [action.id] : []));
                connections = action.all ? [] : connections.filter((connection) => !ids.has(connection.id));
                break;
            }
            case "connect_nodes": {
                const exists = connections.some((connection) => connection.fromNodeId === action.fromNodeId && connection.toNodeId === action.toNodeId);
                const hasNodes = nodes.some((node) => node.id === action.fromNodeId) && nodes.some((node) => node.id === action.toNodeId);
                if (!exists && hasNodes) connections = [...connections, { id: action.id || `link-${nanoid(8)}`, fromNodeId: action.fromNodeId, toNodeId: action.toNodeId }];
                break;
            }
            case "set_viewport":
                viewport = action.viewport;
                break;
            case "select_nodes":
                selectedNodeIds = action.ids.filter((id) => nodes.some((node) => node.id === id));
                break;
            case "run_generation":
                // Generation is handled by the page bridge after structural actions apply.
                break;
        }
    });

    return { ...document, nodes, connections, selectedNodeIds, viewport };
}
