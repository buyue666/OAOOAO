"use client";

import { useEffect, useState, type ReactNode } from "react";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStudio } from "@/lib/studio/store";
import CanvasPage from "@/components/oao-canvas/reference-src/pages/canvas/project";
import CanvasIndexPage from "@/components/oao-canvas/reference-src/pages/canvas/index";
import { encodeChannelModel, useConfigStore, type ChannelModel, type ModelCapability, type ModelChannel } from "@/components/oao-canvas/reference-src/stores/use-config-store";
import "antd/dist/reset.css";
import "@/components/oao-canvas/reference-src/styles/globals.css";

function capabilityOf(value: string): ModelCapability {
    const model = value.toLowerCase();
    if (/video|veo|sora|kling|wan|hailuo|runway/.test(model)) return "video";
    if (/audio|tts|speech|voice|music|sound/.test(model)) return "audio";
    if (/image|gpt-image|imagen|seedream|flux|dall|nano-banana|midjourney/.test(model)) return "image";
    return "text";
}

function CanvasConfigBridge() {
    const { state } = useStudio();

    useEffect(() => {
        const source = state.liveModels.length ? state.liveModels : state.models;
        if (!source.length) return;
        const models: ChannelModel[] = source.map((item) => ({ name: item.id, capability: item.capability === "image" || item.capability === "video" || item.capability === "audio" || item.capability === "text" ? item.capability : capabilityOf(item.id) }));
        const channel: ModelChannel = { id: "oaooao", name: "OAOOAO", baseUrl: "/api", apiKey: "server-managed", apiFormat: "openai", models };
        const values = new Set(models.map((item) => item.name));
        const choose = (capability: ModelCapability, preferred?: string) => {
            if (preferred && values.has(preferred)) return encodeChannelModel(channel.id, preferred);
            const found = models.find((item) => item.capability === capability)?.name || models[0]?.name || "";
            return encodeChannelModel(channel.id, found);
        };
        const defaults = state.sessionSettings?.defaultModels;
        const imageModel = choose("image", defaults?.imageModel);
        const videoModel = choose("video", defaults?.videoModel);
        const textModel = choose("text", defaults?.textModel);
        const audioModel = choose("audio", defaults?.audioModel);
        const current = useConfigStore.getState().config;
        useConfigStore.setState({
            config: {
                ...current,
                channelMode: "local",
                baseUrl: "/api",
                apiKey: "server-managed",
                apiFormat: "openai",
                channels: [channel],
                models: models.map((item) => encodeChannelModel(channel.id, item.name)),
                model: imageModel,
                imageModel,
                videoModel,
                textModel,
                audioModel,
                quality: state.sessionSettings?.generationDefaults?.imageQuality || current.quality || "auto",
                size: state.sessionSettings?.generationDefaults?.imageSize || current.size || "1:1",
                count: String(state.sessionSettings?.generationDefaults?.imageCount || current.count || "1"),
                canvasImageCount: String(state.sessionSettings?.generationDefaults?.canvasImageCount || current.canvasImageCount || "1"),
                vquality: state.sessionSettings?.generationDefaults?.videoQuality || current.vquality || "auto",
                videoSeconds: String(state.sessionSettings?.generationDefaults?.videoSeconds || current.videoSeconds || "8"),
                audioVoice: state.sessionSettings?.generationDefaults?.audioVoice || current.audioVoice,
                audioFormat: state.sessionSettings?.generationDefaults?.audioFormat || current.audioFormat,
            },
        });
    }, [state.liveModels, state.models, state.sessionSettings]);

    return null;
}

export function OaoInfiniteCanvas({ projectId }: { projectId: string }) {
    return (
        <CanvasRuntime>
            <CanvasConfigBridge />
            <CanvasPage projectId={projectId} />
        </CanvasRuntime>
    );
}

export function OaoInfiniteCanvasIndex() {
    return (
        <CanvasRuntime>
            <CanvasConfigBridge />
            <CanvasIndexPage />
        </CanvasRuntime>
    );
}

function CanvasRuntime({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => new QueryClient());
    return (
        <QueryClientProvider client={queryClient}>
            <div className="h-full min-h-0">
                <ConfigProvider theme={{ token: { colorPrimary: "#f5f5f4", colorInfo: "#f5f5f4", colorTextLightSolid: "#171717", borderRadius: 12 } }}>
                    <AntApp className="h-full min-h-0">{children}</AntApp>
                </ConfigProvider>
            </div>
        </QueryClientProvider>
    );
}
