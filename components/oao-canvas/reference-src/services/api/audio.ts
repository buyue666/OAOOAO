import { createAudioTask, getGenerationTask, normalizeTaskResult } from "@/lib/studio/generation-api";
import { modelOptionName, type AiConfig } from "@/components/oao-canvas/reference-src/stores/use-config-store";
import { uploadMediaFile, type UploadedFile } from "@/components/oao-canvas/reference-src/services/file-storage";

type RequestOptions = { signal?: AbortSignal };

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

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const response = await createAudioTask({ model: modelOptionName(config.model || config.audioModel), prompt, format: config.audioFormat, voice: config.audioVoice, surface: "canvas" });
    for (let attempt = 0; attempt < 240; attempt += 1) {
        if (options?.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new DOMException("Aborted", "AbortError");
        const task = (await getGenerationTask("audio", response.data.task.id)).data.task;
        if (task.status === "success") {
            const result = normalizeTaskResult("audio", task.result).media[0];
            if (!result?.url) throw new Error("上游没有返回音频");
            const blob = await fetch(result.url, { signal: options?.signal }).then((item) => item.blob());
            return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/mpeg" });
        }
        if (task.status === "error" || task.status === "cancelled") throw new Error(task.error || "音频生成失败");
        await delay(Math.min(3500, 1500 + attempt * 25), options?.signal);
    }
    throw new Error("音频任务等待超时，请到任务中心查看结果");
}

export async function storeGeneratedAudio(blob: Blob, _format = "mp3"): Promise<UploadedFile> {
    return uploadMediaFile(blob, "audio");
}
