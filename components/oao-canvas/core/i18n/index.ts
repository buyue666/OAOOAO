import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/components/oao-canvas/core/i18n/locales/en-US";
import zhCN from "@/components/oao-canvas/core/i18n/locales/zh-CN";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "oao-canvas:locale";
const localizedZhCN = { ...zhCN, agent: { ...zhCN.agent, events: { ...zhCN.agent.events, diagnostics: "OAO Agent 诊断" } } };
const localizedEnUS = { ...enUS, agent: { ...enUS.agent, events: { ...enUS.agent.events, diagnostics: "OAO Agent diagnostics" } } };

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: localizedZhCN },
        "en-US": { translation: localizedEnUS },
    },
    lng: (typeof window !== "undefined" ? localStorage.getItem(LOCALE_STORAGE_KEY) : null) as AppLocale || "zh-CN",
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "en-US"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export function changeAppLocale(locale: AppLocale) {
    if (typeof window !== "undefined") localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    return i18n.changeLanguage(locale);
}

export default i18n;
