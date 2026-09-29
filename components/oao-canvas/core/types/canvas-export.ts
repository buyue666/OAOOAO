import type { CanvasProject } from "@/components/oao-canvas/core/stores/canvas/use-canvas-store";

export type CanvasExportFile = {
    app: "oao-canvas";
    version: 3;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
