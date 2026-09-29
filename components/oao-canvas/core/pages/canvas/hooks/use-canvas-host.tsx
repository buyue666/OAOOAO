import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/components/oao-canvas/core/services/api/image";
import { imageToDataUrl } from "@/components/oao-canvas/core/services/image-storage";
import { requestVideoGeneration, storeGeneratedVideo } from "@/components/oao-canvas/core/services/api/video";
import { decodeChannelModel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/components/oao-canvas/core/stores/use-config-store";
import { buildGenerationConfig } from "@/components/oao-canvas/core/lib/canvas/canvas-generation-helpers";
import { buildNodeContext } from "@/components/oao-canvas/core/lib/canvas/canvas-node-context";
import { getNodeDefinition } from "@/components/oao-canvas/core/lib/canvas/node-definitions";
import { canvasThemes } from "@/components/oao-canvas/core/lib/canvas-theme";
import type { CanvasNodeToolbarItem, CanvasGenerationApi, CanvasNodeHost } from "@/components/oao-canvas/core/types/canvas-node-definition";
import type { ReferenceImage } from "@/components/oao-canvas/core/types/image";
import type { CanvasAgentOp } from "@/components/oao-canvas/core/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/components/oao-canvas/core/types/canvas";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type CanvasHostParams = {
    effectiveConfig: AiConfig;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (open: boolean) => void;
    theme: CanvasTheme;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    viewportRef: MutableRefObject<ViewportTransform>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    applyAgentOps: (ops?: CanvasAgentOp[]) => unknown;
};

/**
 * OAO canvas host capabilities: expose generation, canvas access, and panel controls
 * to the bundled node system. Nothing is loaded from a remote registry.
 */
export function useCanvasHost(params: CanvasHostParams) {
    const { t } = useTranslation();
    const { effectiveConfig, isAiConfigReady, openConfigDialog, theme, nodesRef, connectionsRef, viewportRef, setNodes, setDialogNodeId, applyAgentOps } = params;

    // Host capabilities available to bundled nodes; methods receive nodeId and are not bound to a specific node.
    const generationApi = useMemo<CanvasGenerationApi>(() => {
        // Convert node reference images (data URLs or URLs) into the ReferenceImage[] expected by the host generation API.
        const toReferences = (refs?: string[]): ReferenceImage[] => (refs || []).filter(Boolean).map((src, index) => ({ id: `oao-ref-${index}`, name: `ref-${index}.png`, type: "image/png", dataUrl: src }));
        // Open the configuration dialog and throw when AI is not configured.
        const ensureReady = (config: AiConfig) => {
            if (!isAiConfigReady(config, config.model)) {
                openConfigDialog(true);
                throw new Error(t("canvas.nodeInteraction.aiConfigRequired"));
            }
        };
        return {
            generateImage: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "image"), count: String(options?.count || 1), ...(options?.model ? { model: options.model } : {}), ...(options?.size ? { size: options.size } : {}) };
                ensureReady(config);
                const references = toReferences(options?.references);
                const items = references.length ? await requestEdit(config, prompt, references, { signal: options?.signal }) : await requestGeneration(config, prompt, { signal: options?.signal });
                const images = await Promise.all(items.map(async (item) => {
                    try {
                        return await imageToDataUrl({ dataUrl: item.dataUrl }, { signal: options?.signal });
                    } catch (error) {
                        if (options?.signal?.aborted) throw error;
                        return item.dataUrl;
                    }
                }));
                return { images };
            },
            generateVideo: async (prompt, options) => {
                const config = {
                    ...buildGenerationConfig(effectiveConfig, undefined, "video"),
                    ...(options?.model ? { model: options.model } : {}),
                    ...(options?.size ? { size: options.size } : {}),
                    ...(options?.seconds ? { videoSeconds: options.seconds } : {}),
                };
                ensureReady(config);
                const file = await storeGeneratedVideo(await requestVideoGeneration(config, prompt, toReferences(options?.references), { signal: options?.signal }));
                return { url: file.url, mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs };
            },
            generateText: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "text"), ...(options?.model ? { model: options.model } : {}) };
                ensureReady(config);
                const messages: AiTextMessage[] = [...(options?.system ? [{ role: "system" as const, content: options.system }] : []), { role: "user" as const, content: prompt }];
                const text = await requestImageQuestion(config, messages, (delta) => options?.onDelta?.(delta), { signal: options?.signal });
                return { text };
            },
            // List configured models for a capability; labels use the model name without the channel prefix.
            listModels: (capability) => selectableModelsByCapability(effectiveConfig, capability as ModelCapability | undefined).map((value) => ({ value, label: decodeChannelModel(value)?.model || value })),
            defaultModel: (capability) => buildGenerationConfig(effectiveConfig, undefined, capability).model,
        };
    }, [effectiveConfig, isAiConfigReady, openConfigDialog, t]);

    const canvasHost = useMemo<CanvasNodeHost>(
        () => ({
            getNode: (id) => nodesRef.current.find((node) => node.id === id) || null,
            getNodes: () => nodesRef.current,
            getConnections: () => connectionsRef.current,
            getUpstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.toNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            getDownstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.fromNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.toNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            updateNode: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))),
            updateMetadata: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))),
            applyOps: (ops) => applyAgentOps(ops),
            ai: generationApi,
            openPanel: (nodeId) => setDialogNodeId(nodeId),
            closePanel: () => setDialogNodeId(null),
        }),
        [applyAgentOps, generationApi],
    );

    const renderNodeDefinitionPanel = useCallback(
        (panelNode: CanvasNodeData) => {
            const Panel = getNodeDefinition(panelNode.type)?.Panel;
            if (!Panel) return null;
            const ctx = buildNodeContext(canvasHost, panelNode, theme, viewportRef.current.k);
            return <Panel ctx={ctx} onClose={() => setDialogNodeId(null)} />;
        },
        [canvasHost, theme],
    );

    // Build the node toolbar from bundled node actions and the interaction/move toggle when enabled.
    const buildNodeToolbarItems = useCallback(
        (node: CanvasNodeData): CanvasNodeToolbarItem[] => {
            const definition = getNodeDefinition(node.type);
            const ctx = buildNodeContext(canvasHost, node, theme, viewportRef.current.k);
            const custom = definition?.toolbar?.(ctx) || [];
            // Show the interaction/move toggle only for nodes with content that are not forced into an interactive state.
            if (!definition?.interactionToggle || !node.metadata?.content || definition.forceInteractive?.(node)) return custom;
            const interactive = Boolean(node.metadata?.interactive);
            const toggle: CanvasNodeToolbarItem = {
                id: "node-interaction-toggle",
                title: t(interactive ? "canvas.nodeInteraction.interactiveTitle" : "canvas.nodeInteraction.movableTitle"),
                label: t(interactive ? "canvas.nodeInteraction.move" : "canvas.nodeInteraction.interact"),
                icon: interactive ? "✋" : "🖐",
                active: interactive,
                onClick: () => canvasHost.updateMetadata(node.id, { interactive: !interactive }),
            };
            return [toggle, ...custom];
        },
        [canvasHost, t, theme],
    );

    return { canvasHost, renderNodeDefinitionPanel, buildNodeToolbarItems };
}
