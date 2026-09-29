import { App, Button, Form, Input, Switch } from "antd";
import { Network, Wifi } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { testLocalProxy } from "@/components/oao-canvas/core/services/api/local-proxy";
import { DEFAULT_LOCAL_PROXY_URL, normalizeLocalProxyUrl, useConfigStore } from "@/components/oao-canvas/core/stores/use-config-store";

export function ConfigLocalProxy() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [testing, setTesting] = useState(false);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);

    const testProxy = async () => {
        setTesting(true);
        try {
            message.success(t("config.proxy.available", { proxy: await testLocalProxy(config.proxyUrl) }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.proxy.unreachable"));
        } finally {
            setTesting(false);
        }
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Network className="size-4" />
                            {t("config.proxy.title")}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">{t("config.proxy.description")}</div>
                    </div>
                    <Switch checked={config.proxyEnabled} onChange={(checked) => updateConfig("proxyEnabled", checked)} />
                </div>
                {config.proxyEnabled ? (
                    <>
                        <Form.Item label={t("config.proxy.address")} extra={t("config.proxy.addressDescription")} className="mt-3 mb-0">
                            <Input
                                value={config.proxyUrl}
                                placeholder={DEFAULT_LOCAL_PROXY_URL}
                                onChange={(event) => updateConfig("proxyUrl", event.target.value)}
                                onBlur={(event) => updateConfig("proxyUrl", normalizeLocalProxyUrl(event.target.value) || DEFAULT_LOCAL_PROXY_URL)}
                            />
                        </Form.Item>
                        <Button className="mt-3" icon={<Wifi className="size-4" />} loading={testing} onClick={() => void testProxy()}>
                            {t("config.proxy.test")}
                        </Button>
                        <div className="mt-3 text-xs text-stone-500">{t("config.proxy.channelHint")}</div>
                    </>
                ) : null}
            </section>
        </Form>
    );
}
