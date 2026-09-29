import type { ComponentType, ReactNode } from "react";

import type { CanvasAgentOp } from "@/components/oao-canvas/core/lib/canvas/canvas-agent-ops";
import type { CanvasTheme } from "@/components/oao-canvas/core/lib/canvas-theme";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/components/oao-canvas/core/types/canvas";
import type { CanvasResourceKind } from "@/components/oao-canvas/core/lib/canvas/canvas-resource-references";

export type CanvasNodeResource = { kind: CanvasResourceKind; text?: string; url?: string };

export type GenerateOptions = { signal?: AbortSignal; references?: string[]; model?: string };
export type GenerateImageOptions = GenerateOptions & { count?: number; size?: string };
export type GenerateImageResult = { images: string[] };
export type GenerateVideoOptions = GenerateOptions & { size?: string; seconds?: string };
export type GenerateVideoResult = { url: string; mimeType: string; width?: number; height?: number; durationMs?: number };
export type GenerateTextOptions = { signal?: AbortSignal; model?: string; system?: string; onDelta?: (text: string) => void };
export type GenerateTextResult = { text: string };
export type CanvasModelCapability = "image" | "video" | "text" | "audio";
export type ModelOption = { value: string; label: string };

/** Generation APIs exposed to OAO's built-in nodes and Agent. */
export type CanvasGenerationApi = {
    generateImage: (prompt: string, options?: GenerateImageOptions) => Promise<GenerateImageResult>;
    generateVideo: (prompt: string, options?: GenerateVideoOptions) => Promise<GenerateVideoResult>;
    generateText: (prompt: string, options?: GenerateTextOptions) => Promise<GenerateTextResult>;
    listModels: (capability?: CanvasModelCapability) => ModelOption[];
    defaultModel: (capability: CanvasModelCapability) => string;
};

export type CanvasNodeToolbarItem = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

/** Context shared by OAO node renderers, toolbar actions, and Agent operations. */
export type CanvasNodeContext = {
    node: CanvasNodeData;
    theme: CanvasTheme;
    scale: number;
    isSelected: boolean;
    updateMetadata: (patch: CanvasNodeMetadata) => void;
    updateNode: (patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => void;
    getNode: (id: string) => CanvasNodeData | null;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    getUpstream: () => CanvasNodeData[];
    getDownstream: () => CanvasNodeData[];
    applyOps: (ops: CanvasAgentOp[]) => void;
    ai: CanvasGenerationApi;
    openPanel: () => void;
    closePanel: () => void;
};

/** Canvas capabilities passed into a node without exposing a remote extension system. */
export type CanvasNodeHost = {
    getNode: (id: string) => CanvasNodeData | null;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    getUpstream: (nodeId: string) => CanvasNodeData[];
    getDownstream: (nodeId: string) => CanvasNodeData[];
    updateNode: (nodeId: string, patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => void;
    updateMetadata: (nodeId: string, patch: CanvasNodeMetadata) => void;
    applyOps: (ops: CanvasAgentOp[]) => void;
    ai: CanvasGenerationApi;
    openPanel: (nodeId: string) => void;
    closePanel: () => void;
};

export type CanvasBuiltinPanelConfig = {
    mode: "image" | "video" | "text" | "audio";
    promptPrefix?: string;
    writeBackToSelf?: boolean;
};

/** Definition of a first-party OAO node. All node types are bundled with the canvas. */
export type CanvasNodeDefinition = {
    type: string;
    title: string;
    icon: ReactNode;
    description?: string;
    defaultSize: { width: number; height: number };
    defaultMetadata?: CanvasNodeMetadata;
    minimapColor?: string;
    showInCreateMenu?: boolean;
    hasSourceHandle?: boolean;
    hidePanel?: boolean;
    transparentBackground?: boolean;
    autoOpenPanel?: boolean;
    useBuiltinPanel?: CanvasBuiltinPanelConfig;
    interactionToggle?: boolean;
    forceInteractive?: (node: CanvasNodeData) => boolean;
    keepAspectRatio?: (node: CanvasNodeData) => boolean;
    resource?: (node: CanvasNodeData) => CanvasNodeResource | null;
    Content?: ComponentType<{ ctx: CanvasNodeContext }>;
    Panel?: ComponentType<{ ctx: CanvasNodeContext; onClose: () => void }>;
    toolbar?: (ctx: CanvasNodeContext) => CanvasNodeToolbarItem[];
    onDoubleClick?: (ctx: CanvasNodeContext) => boolean;
};
