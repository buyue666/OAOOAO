import { createVideoTask, getGenerationTask, normalizeTaskResult } from "@/lib/studio/generation-api";
import type { GenerationReference } from "@/lib/studio/generation-types";
import { modelOptionName, type AiConfig } from "@/components/oao-canvas/core/stores/use-config-store";
import { uploadMediaFile, type UploadedFile } from "@/components/oao-canvas/core/services/file-storage";
import type { ReferenceImage } from "@/components/oao-canvas/core/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/components/oao-canvas/core/types/media";

type RequestOptions = { signal?: AbortSignal };
export type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        if (!signal) return;
        const abort = () => {
            window.clearTimeout(timer);
            reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
        };
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
    });
}

function modelFor(config: AiConfig) {
    return modelOptionName(config.model || config.videoModel);
}

function generationReferences(images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]): GenerationReference[] {
    return [
        ...images.map((item) => ({ name: item.name, type: item.type || "image/png", url: item.url, dataUrl: item.dataUrl })),
        ...videos.map((item) => ({ name: item.name, type: item.type || "video/mp4", url: item.url })),
        ...audios.map((item) => ({ name: item.name, type: item.type || "audio/mpeg", url: item.url })),
    ];
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const response = await createVideoTask({
        prompt,
        model: modelFor(config),
        ratio: config.size,
        quality: config.vquality,
        seconds: Number(config.videoSeconds) || undefined,
        references: generationReferences(references, options?.videos || [], options?.audios || []),
        surface: "canvas",
    });
    return { id: response.data.task.id, provider: "openai", model: modelFor(config) };
}

export async function pollVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        throwIfAborted(options?.signal);
        const response = await getGenerationTask("video", task.id);
        const current = response.data.task;
        if (current.status === "success") {
            const media = normalizeTaskResult("video", current.result).media[0];
            return media ? { status: "completed", result: { url: media.url, mimeType: media.mimeType || "video/mp4" } } : { status: "failed", error: "上游没有返回视频" };
        }
        if (current.status === "error" || current.status === "cancelled") return { status: "failed", error: current.error || "视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        if (options?.signal?.aborted) throw error;
        throw error;
    }
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions) {
    for (let attempt = 0; attempt < 240; attempt += 1) {
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw videoTaskFailed(state.error);
        await delay(Math.min(4000, 1500 + attempt * 25), options?.signal);
    }
    throw videoTaskFailed("视频任务等待超时，请到任务中心查看结果");
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions) {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) return uploadMediaFile(result.url, "video");
    throw videoTaskFailed("视频结果为空");
}

export async function storeGeneratedVideoResult(result: VideoGenerationResult) {
    return storeGeneratedVideo(result);
}
