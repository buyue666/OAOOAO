import type { ReferenceImage } from "@/components/oao-canvas/core/types/image";

import i18n from "@/components/oao-canvas/core/i18n";

export function imageReferenceLabel(index: number) {
    return i18n.t("imageReferences.label", { index: index + 1 });
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const labels = references.map((_, index) => imageReferenceLabel(index));
    return i18n.t("imageReferences.promptPrefix", { labels: labels.join(i18n.t("imageReferences.separator")), prompt: text });
}
