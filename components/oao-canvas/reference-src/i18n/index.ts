import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/components/oao-canvas/reference-src/i18n/locales/en-US";
import zhCN from "@/components/oao-canvas/reference-src/i18n/locales/zh-CN";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "infinite-canvas:locale";

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: zhCN },
        "en-US": { translation: enUS },
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
