import { createImageTask, createTextTask, getGenerationTask, normalizeTaskResult } from "@/lib/studio/generation-api";
import type { ImageGenerationInput, GenerationReference } from "@/lib/studio/generation-types";
import { modelOptionName, type AiConfig, type ModelChannel } from "@/components/oao-canvas/reference-src/stores/use-config-store";
import type { ReferenceImage } from "@/components/oao-canvas/reference-src/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type RequestOptions = { signal?: AbortSignal };
export type GeneratedImage = { id: string; dataUrl: string };

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

function modelFor(config: AiConfig, capability: "image" | "text") {
    return modelOptionName(capability === "image" ? config.model || config.imageModel : config.model || config.textModel);
}

function referencesFor(references: ReferenceImage[]): GenerationReference[] {
    return references.map((reference) => ({ name: reference.name, type: reference.type || "image/png", url: reference.url, dataUrl: reference.dataUrl }));
}

async function waitForResult(kind: "image" | "text", taskId: string, options?: RequestOptions) {
    for (let attempt = 0; attempt < 240; attempt += 1) {
        throwIfAborted(options?.signal);
        const response = await getGenerationTask(kind, taskId);
        const task = response.data.task;
        if (task.status === "success") return normalizeTaskResult(kind, task.result);
        if (task.status === "error" || task.status === "cancelled") throw new Error(task.error || "生成失败，请重试");
        await delay(Math.min(2500, 900 + attempt * 30), options?.signal);
    }
    throw new Error("任务等待超时，请到任务中心查看结果");
}

function imageResults(result: { media?: Array<{ url: string }>; text?: string }): GeneratedImage[] {
    return (result.media || []).filter((item) => item.url).map((item) => ({ id: crypto.randomUUID(), dataUrl: item.url }));
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const count = Math.max(1, Math.min(15, Number.parseInt(config.count || "1", 10) || 1));
    const input: ImageGenerationInput = {
        prompt,
        model: modelFor(config, "image"),
        ratio: config.size,
        quality: config.quality,
        count,
        surface: "canvas",
    };
    const response = await createImageTask(input);
    const result = await waitForResult("image", response.data.task.id, options);
    const images = imageResults(result);
    if (!images.length) throw new Error(result.text || "上游没有返回图片");
    return images;
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const count = Math.max(1, Math.min(15, Number.parseInt(config.count || "1", 10) || 1));
    const response = await createImageTask({
        prompt,
        model: modelFor(config, "image"),
        ratio: config.size,
        quality: config.quality,
        count,
        kind: "edit",
        references: referencesFor(references),
        surface: "canvas",
    });
    const result = await waitForResult("image", response.data.task.id, options);
    const images = imageResults(result);
    if (!images.length) throw new Error(result.text || "上游没有返回图片");
    return images;
}

function textFromMessage(message: AiTextMessage) {
    if (typeof message.content === "string") return message.content;
    return message.content.map((part) => part.type === "text" ? part.text : "[参考图片]").join("\n");
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const prompt = messages.map(textFromMessage).join("\n\n").trim();
    const response = await createTextTask({ prompt, model: modelFor(config, "text") });
    const result = await waitForResult("text", response.data.task.id, options);
    const text = result.text || "";
    if (text) onDelta(text);
    return text;
}

/** 仅供画布内模型选择器读取 OAOOAO 的逻辑模型，不读取渠道密钥。 */
export async function fetchChannelModels(_channel?: ModelChannel) {
    return [] as string[];
}
