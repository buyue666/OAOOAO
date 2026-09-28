import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { createCanvasProject, deleteCanvasProjects, getCanvasProject, listCanvasProjects, request, type CanvasBackendNode, type CanvasBackendProject } from "@/lib/studio/api";
import type { CanvasBackgroundMode } from "@/components/oao-canvas/reference-src/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasNodeMetadata, ViewportTransform } from "@/components/oao-canvas/reference-src/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = { id: string; deletedAt: string };

type CanvasStore = {
    hydrated: boolean;
    remoteReady: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const DEFAULT_NODE_SIZE = { width: 340, height: 240 };

function finite(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function nodeType(value: unknown, fallback: CanvasNodeData["type"]): CanvasNodeData["type"] {
    const raw = String(value || "");
    if (["image", "video", "audio", "text", "config", "group"].includes(raw)) return raw as CanvasNodeData["type"];
    return fallback;
}

function normalizeNode(raw: CanvasBackendNode, index: number): CanvasNodeData {
    const source = raw.data && typeof raw.data === "object" ? raw.data : {};
    const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
    const nested = source.metadata && typeof source.metadata === "object" ? source.metadata as CanvasNodeMetadata : {};
    const oldKind = String(source.kind || raw.type || "text");
    const fallbackType = oldKind === "task" ? "config" : nodeType(oldKind, "text");
    const type = nodeType(source.type || raw.type, fallbackType);
    const width = finite(source.width ?? metadata.width, type === "video" ? 420 : DEFAULT_NODE_SIZE.width);
    const height = finite(source.height ?? metadata.height, type === "video" ? 236 : DEFAULT_NODE_SIZE.height);
    const title = typeof source.title === "string" && source.title.trim() ? source.title : `画布节点 ${index + 1}`;
    const oldContent = typeof source.src === "string" ? source.src : typeof source.content === "string" ? source.content : undefined;
    const oldPrompt = typeof source.prompt === "string" ? source.prompt : typeof source.detail === "string" && oldKind === "text" ? source.detail : undefined;
    const combinedMetadata: CanvasNodeMetadata = {
        ...metadata,
        ...nested,
        ...(oldContent && !nested.content && !metadata.content ? { content: oldContent } : {}),
        ...(oldPrompt && !nested.prompt && !metadata.prompt ? { prompt: oldPrompt } : {}),
        ...(typeof source.status === "string" && !metadata.status ? { status: source.status === "生成中" ? "loading" : source.status === "待确认" ? "idle" : "success" } : {}),
        ...(typeof source.model === "string" && !metadata.model ? { model: source.model } : {}),
        ...(typeof source.ratio === "string" && !metadata.size ? { size: source.ratio } : {}),
        ...(typeof source.quality === "string" && !metadata.quality ? { quality: source.quality } : {}),
    };
    return {
        id: raw.id,
        type,
        title,
        position: { x: finite(raw.position?.x, 0), y: finite(raw.position?.y, index * 280) },
        width,
        height,
        metadata: combinedMetadata,
    };
}

function fromBackend(project: CanvasBackendProject): CanvasProject {
    return {
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        nodes: (project.nodes || []).map(normalizeNode),
        connections: (project.connections || []).map((connection) => ({ id: connection.id, fromNodeId: connection.source, toNodeId: connection.target })),
        chatSessions: Array.isArray(project.chatSessions) ? project.chatSessions as CanvasAssistantSession[] : [],
        activeChatId: typeof project.activeChatId === "string" ? project.activeChatId : null,
        backgroundMode: project.backgroundMode === "dots" || project.backgroundMode === "blank" ? project.backgroundMode : "lines",
        showImageInfo: Boolean(project.showImageInfo),
        viewport: { x: finite(project.viewport?.x, initialViewport.x), y: finite(project.viewport?.y, initialViewport.y), k: Math.min(5, Math.max(0.05, finite(project.viewport?.k, initialViewport.k))) },
    };
}

function toBackend(project: CanvasProject) {
    return {
        nodes: project.nodes.map((node) => ({ id: node.id, type: node.type, position: node.position, data: { title: node.title, type: node.type, width: node.width, height: node.height }, metadata: { ...(node.metadata || {}), width: node.width, height: node.height } })),
        connections: project.connections.map((connection) => ({ id: connection.id, source: connection.fromNodeId, target: connection.toNodeId })),
        chatSessions: project.chatSessions,
        activeChatId: project.activeChatId,
        backgroundMode: project.backgroundMode,
        showImageInfo: project.showImageInfo,
        viewport: project.viewport,
    };
}

type RemoteSaveQueueEntry = { latest: CanvasProject | null; running: boolean };
const remoteSaveQueue = new Map<string, RemoteSaveQueueEntry>();

async function flushRemoteSave(projectId: string) {
    const entry = remoteSaveQueue.get(projectId);
    if (!entry) return;
    while (entry.latest) {
        const project = entry.latest;
        entry.latest = null;
        try {
            const result = await request<{ data?: { project?: CanvasBackendProject; ack?: { updatedAt?: string } } }>(`/api/canvas/projects/${encodeURIComponent(project.id)}`, {
                method: "PATCH",
                body: JSON.stringify({ expectedUpdatedAt: project.updatedAt, project: { id: project.id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt, ...toBackend(project) } }),
            });
            const updatedAt = result.data?.project?.updatedAt || result.data?.ack?.updatedAt;
            if (updatedAt) {
                useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === project.id ? { ...item, updatedAt } : item) }));
                if (entry.latest) entry.latest = Object.assign({}, entry.latest as CanvasProject, { updatedAt });
            }
        } catch (error) {
            console.warn("画布自动保存失败", error);
        }
    }
    remoteSaveQueue.delete(projectId);
}

function saveRemote(project: CanvasProject) {
    const entry = remoteSaveQueue.get(project.id) || { latest: null, running: false };
    entry.latest = project;
    remoteSaveQueue.set(project.id, entry);
    if (!entry.running) {
        entry.running = true;
        void flushRemoteSave(project.id);
    }
}

let remoteSyncStarted = false;
async function syncRemoteProjects() {
    if (remoteSyncStarted) return;
    remoteSyncStarted = true;
    try {
        const result = await listCanvasProjects();
        const projects: CanvasProject[] = [];
        for (const summary of result.projects || []) {
            try {
                projects.push(fromBackend(await getCanvasProject(summary.id)));
            } catch {
                // One inaccessible project must not hide the remaining canvas list.
            }
        }
        if (projects.length) useCanvasStore.getState().replaceProjects(projects);
    } catch {
        // The local draft remains available when the user is signed out or the API is offline.
    } finally {
        useCanvasStore.setState({ remoteReady: true });
    }
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            remoteReady: false,
            projects: [],
            deletedProjects: [],
            createProject: async (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = `canvas-${nanoid(10)}`;
                const project: CanvasProject = { id, title, createdAt: now, updatedAt: now, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: initialViewport };
                set((state) => ({ projects: [project, ...state.projects] }));
                try {
                    const remote = await createCanvasProject({ title });
                    const hydrated = { ...fromBackend(remote), title };
                    set((state) => ({ projects: state.projects.map((item) => item.id === id ? hydrated : item) }));
                    return hydrated.id;
                } catch {
                    // Keep the local draft usable when the API is unavailable.
                    return id;
                }
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = { id: `canvas-${nanoid(10)}`, title: source.title || "导入画布", createdAt: source.createdAt || now, updatedAt: now, nodes: source.nodes || [], connections: source.connections || [], chatSessions: source.chatSessions || [], activeChatId: source.activeChatId || null, backgroundMode: source.backgroundMode || "lines", showImageInfo: Boolean(source.showImageInfo), viewport: source.viewport || initialViewport };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => get().projects.find((project) => project.id === id) || null,
            renameProject: (id, title) => set((state) => {
                const project = state.projects.find((item) => item.id === id);
                const next = project ? { ...project, title: title.trim() || project.title } : null;
                if (next) void saveRemote(next);
                return next ? { projects: state.projects.map((item) => item.id === id ? next : item) } : state;
            }),
            deleteProjects: (ids) => {
                set((state) => ({ projects: state.projects.filter((project) => !ids.includes(project.id)), deletedProjects: [...state.deletedProjects, ...ids.map((id) => ({ id, deletedAt: new Date().toISOString() }))] }));
                void deleteCanvasProjects(ids).catch(() => undefined);
            },
            replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
            updateProject: (id, patch) => set((state) => {
                const project = state.projects.find((item) => item.id === id);
                if (!project) return state;
                const next = { ...project, ...patch };
                saveRemote(next);
                return { projects: state.projects.map((item) => item.id === id ? next : item) };
            }),
        }),
        {
            name: "oaooao:infinite-canvas",
            partialize: (state) => ({ projects: state.projects, deletedProjects: state.deletedProjects }),
            onRehydrateStorage: () => (_state, error) => {
                // Zustand can invoke this callback while the store export is still
                // being initialized. Defer the store write until the module exists.
                queueMicrotask(() => {
                    if (error) console.warn("无限画布本地数据恢复失败", error);
                    useCanvasStore.setState({ hydrated: true });
                    void syncRemoteProjects();
                });
            },
        },
    ),
);
