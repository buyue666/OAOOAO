import { create } from "zustand";

import i18n from "@/components/oao-canvas/core/i18n";
import { CanvasNodeType } from "@/components/oao-canvas/core/types/canvas";
import type { CanvasNodeDefinition } from "@/components/oao-canvas/core/types/canvas-node-definition";

const definitions = new Map<string, CanvasNodeDefinition>();

// The registry is deliberately local and first-party: OAO ships every node renderer with the canvas.
export const useNodeDefinitionsVersion = create<{ version: number }>(() => ({ version: 0 }));

function bump() {
    useNodeDefinitionsVersion.setState((state) => ({ version: state.version + 1 }));
}

export function registerNodeDefinitions(defs: CanvasNodeDefinition[]) {
    defs.forEach((definition) => definitions.set(definition.type, definition));
    bump();
}

export function getNodeDefinition(type: string) {
    return definitions.get(type);
}

export function listNodeDefinitions() {
    return Array.from(definitions.values());
}

export function isRegisteredNodeType(type: string) {
    return definitions.has(type);
}

const FALLBACK_SPEC = { width: 340, height: 240, title: i18n.t("canvas.node.node"), metadata: {} as CanvasNodeDefinition["defaultMetadata"] };

export function getNodeSpec(type: string) {
    const definition = definitions.get(type);
    if (!definition) return FALLBACK_SPEC;
    return { width: definition.defaultSize.width, height: definition.defaultSize.height, title: definition.title, metadata: definition.defaultMetadata };
}

export function isBuiltinNodeType(type: string) {
    return (Object.values(CanvasNodeType) as string[]).includes(type);
}
