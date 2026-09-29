import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const runtime = resolve(process.cwd(), "..", "backups", "vozeb-pro-v007-points-loop-20260910", "VOZEB-PRO-ciyuan-v007-20260824", "web", "package.json");
const { chromium } = createRequire(runtime)("@playwright/test");
const base = process.env.OAOAO_BASE || "http://127.0.0.1:3310";
const storageState = resolve(process.cwd(), "tests", ".sessions", "fusion_admin-3310.json");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...(existsSync(storageState) ? { storageState } : {}), viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
function check(label, value) {
    assert.ok(value, label);
    checks.push(label);
}

let originalProject = null;
try {
    await page.goto(`${base}/canvas/canvas-aurora`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(650);
    originalProject = await page.evaluate(async () => (await fetch("/api/canvas/projects/canvas-aurora", { cache: "no-store" })).json()).then((result) => result.data?.project || null);

    const body = await page.locator("body").innerText();
    const rail = await page.locator(".canvas-workspace-rail").innerText();
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    check("页面使用 OAO 自由画布标题", body.includes("画布") && body.includes("开始生成"));
    check("画布保留节点生成入口", await page.locator("button").filter({ hasText: "开始生成" }).count() >= 1);
    check("节点与资产是画布的两个工作区", rail.includes("节点") && rail.includes("资产") && !rail.includes("提示词"));
    check("界面使用 OAO Agent 品牌", body.includes("OAO Agent") && !body.includes("Codex"));
    check("运行时不暴露旧项目或插件入口", !/Infinite Canvas|infinite-canvas|basketikun|reference-src|插件市场|官方插件|GitHub/i.test(body));
    check("运行时没有加载外部插件清单", resources.every((url) => !/infinite-canvas|plugin-registry|plugin-loader|basketikun/i.test(url)));

    await page.locator('button[aria-label="打开画布菜单"]').click();
    const menuText = await page.locator('[role="menu"]').innerText();
    check("画布菜单只提供 OAO 操作", /新建画布|导入画布|导出画布/.test(menuText) && !/插件|GitHub|文档|版本/.test(menuText));
    await page.keyboard.press("Escape");

    const pane = page.locator('[data-oao-canvas-surface="free-canvas"]');
    check("OAO 自由画布平面已挂载", await pane.count() === 1);
    await pane.click({ button: "right", position: { x: 180, y: 220 } });
    check("空白处右键打开节点菜单", await page.locator('[data-canvas-create-menu="node"]').isVisible());
    const nodeCountBeforeCreate = await page.locator("[data-node-id]").count();
    await page.locator('[data-canvas-create-menu="node"] button').filter({ hasText: "图片" }).click();
    await page.waitForTimeout(150);
    check("右键直接创建画布内生图节点", await page.locator("[data-node-id]").count() > nodeCountBeforeCreate);
    check("右键生成打开节点内编辑器", (await page.locator("body").innerText()).includes("开始生成"));
    await page.keyboard.press("Escape");

    const node = page.locator(".node-element").first();
    await node.hover();
    const expand = node.getByRole("button", { name: /添加后续节点/ });
    check("节点提供动态后续节点入口", await expand.count() >= 1 && await expand.first().isVisible());
    await expand.first().evaluate((button) => button.click());
    check("后续节点菜单由画布内提供", await page.locator("[data-connection-create-menu]").isVisible());
    await page.screenshot({ path: ".codex-tmp/canvas-oao-smoke.png", animations: "disabled" });
    check("画布无未捕获浏览器异常", errors.length === 0);
    console.log(`CANVAS_SMOKE_OK ${checks.length}`);
} finally {
    if (originalProject) {
        await page.evaluate(async (project) => {
            const current = await (await fetch(`/api/canvas/projects/${project.id}`, { cache: "no-store" })).json();
            const value = current.data?.project;
            if (!value) return;
            await fetch(`/api/canvas/projects/${project.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ expectedUpdatedAt: value.updatedAt, project: { ...value, nodes: project.nodes, connections: project.connections } }),
            });
        }, originalProject).catch(() => undefined);
    }
    await browser.close();
}
