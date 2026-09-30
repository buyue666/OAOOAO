import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const runtime = resolve(process.cwd(), "..", "backups", "vozeb-pro-v007-points-loop-20260910", "VOZEB-PRO-ciyuan-v007-20260824", "web", "package.json");
const { chromium } = createRequire(runtime)("@playwright/test");
const base = process.env.OAOAO_BASE || "http://127.0.0.1:3310";
const storageState = resolve(process.cwd(), "tests", ".sessions", "fusion_admin-3310.json");
const artifacts = resolve(process.cwd(), "tests", ".artifacts", "canvas-ui");
mkdirSync(artifacts, { recursive: true });

const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
function check(label, value) {
    assert.ok(value, label);
    checks.push(label);
}
async function pageHealth(page, label) {
    const viewport = page.viewportSize();
    const result = await page.evaluate(({ width, height }) => {
        const visibleElements = [...document.querySelectorAll(".oao-canvas-header button, .oao-canvas-actions button, .canvas-workspace-rail button, .oao-canvas-side-panel button, .oao-canvas-side-panel input, [data-canvas-shortcuts-ignore] button")].filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none" && rect.width > 0 && rect.height > 0;
        });
        const outside = visibleElements.filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left < -2 || rect.top < -2 || rect.right > width + 2 || rect.bottom > height + 2;
        }).map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 80), rect: element.getBoundingClientRect().toJSON() }));
    const clipped = visibleElements.filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width < 16 || rect.height < 16;
        }).map((element) => (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 80));
        return { outside, clipped };
    }, { width: viewport.width, height: viewport.height });
    check(`${label}: 可交互元素没有跑出视口`, result.outside.length === 0);
    check(`${label}: 可交互元素保持可点击尺寸`, result.clipped.length === 0);
}

async function run(viewport, name) {
    const context = await browser.newContext({ ...(existsSync(storageState) ? { storageState } : {}), viewport });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    await page.goto(`${base}/canvas/canvas-aurora`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.getByText("开始生成", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(250);
    check(`${name}: 顶部 OAO Agent 按钮可见`, await page.getByRole("button", { name: "OAO Agent" }).isVisible());
    check(`${name}: 创建按钮可见`, await page.locator(".oao-canvas-actions-create").isVisible());
    await page.screenshot({ path: resolve(artifacts, `${name}-initial.png`), animations: "disabled" });

    const railToggle = page.getByRole("button", { name: "展开工作区面板" });
    if (await railToggle.count()) {
        await railToggle.click();
        await page.waitForTimeout(550);
        check(`${name}: 节点工作区面板打开`, (await page.getByText("节点", { exact: true }).count()) > 0);
        const assetButton = page.getByRole("button", { name: "资产", exact: true }).last();
        if (await assetButton.count()) {
            await assetButton.click();
            await page.waitForTimeout(250);
            const assetPanel = page.locator(".oao-canvas-side-panel");
            check(`${name}: 资产工作区可以切换`, (await assetPanel.innerText()).includes("资产") && (await assetPanel.getByRole("button", { name: "添加", exact: true }).count()) === 1);
            await page.screenshot({ path: resolve(artifacts, `${name}-assets.png`), animations: "disabled" });
        }
    }

    await page.getByRole("button", { name: "OAO Agent" }).click();
    await page.waitForTimeout(650);
    const agentPanel = page.locator("[data-canvas-shortcuts-ignore]").last();
    const agentBox = await agentPanel.boundingBox();
    check(`${name}: Agent 面板打开不遮挡主画布`, Boolean(agentBox && agentBox.width >= 320 && agentBox.x >= 0 && agentBox.x + agentBox.width <= viewport.width + 2));
    const agentAppearance = await page.evaluate(() => {
        const panel = document.querySelector(".oao-platform-agent");
        const input = panel?.querySelector("textarea");
        const assetSearch = document.querySelector(".oao-canvas-side-panel input");
        const read = (element) => {
            if (!element) return null;
            const style = getComputedStyle(element);
            return { color: style.color, background: style.backgroundColor };
        };
        return { panel: read(panel), input: read(input), assetSearch: read(assetSearch), hasLocalConnectCopy: Boolean(panel?.textContent?.match(/Local URL|Connect token|连接 Token/)) };
    });
    check(`${name}: Agent 使用平台内置入口`, agentAppearance.hasLocalConnectCopy === false);
    check(`${name}: Agent 输入控件保持深色对比`, Boolean(agentAppearance.input && agentAppearance.input.color !== agentAppearance.input.background));
    check(`${name}: 资产搜索控件保持深色对比`, !agentAppearance.assetSearch || agentAppearance.assetSearch.color !== agentAppearance.assetSearch.background);
    await page.screenshot({ path: resolve(artifacts, `${name}-agent.png`), animations: "disabled" });
    await page.getByRole("button", { name: /收起 Agent/ }).click({ force: true });
    await page.waitForTimeout(550);
    await pageHealth(page, name);
    await context.close();
}

try {
    await run({ width: 1440, height: 1000 }, "desktop");
    await run({ width: 390, height: 844 }, "mobile");
    check("浏览器没有未捕获异常", errors.length === 0);
    console.log(`CANVAS_UI_OK ${checks.length}`);
} finally {
    await browser.close();
}
