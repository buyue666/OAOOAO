import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const runtime = process.env.PLAYWRIGHT_ROOT || resolve(process.cwd(), "..", "backups", "vozeb-pro-v007-points-loop-20260910", "VOZEB-PRO-ciyuan-v007-20260824", "web");
const { chromium } = createRequire(resolve(runtime, "package.json"))("@playwright/test");
const base = process.env.OAOAO_BASE || "http://127.0.0.1:3310";
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: resolve("tests/.sessions/fusion_admin-3310.json"), viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const requests = [];
const errors = [];
let run;
let streamCount = 0;
let checks = 0;
const check = (label, value) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
const json = (route, data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code: status === 200 ? 0 : status, data }) });
const event = (type, data, id) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ id, type, data })}\n\n`;
page.on("pageerror", error => errors.push(error.message));

// All writes are intercepted, so this exercises the UI without creating paid tasks or saving test nodes.
await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.startsWith("/api/agent/runs")) {
        if (path.endsWith("/events")) {
            streamCount++;
            const ops = [{ type: "add_node", id: "agent-flow-output", nodeType: "text", title: "Agent 回写测试", metadata: { content: "四个镜头的分镜", status: "success" } }, { type: "run_generation", nodeId: "agent-flow-output" }];
            const body = run.status === "completed"
                ? event("canvas.ops", { ops, reply: "已完成分镜" }, "1") + event("canvas.ops", { ops }, "1") + event("run.completed", {}, "2")
                : `event: run.snapshot\ndata: ${JSON.stringify({ id: run.id, status: run.status })}\n\n`;
            return route.fulfill({ status: 200, contentType: "text/event-stream", body });
        }
        if (request.method() === "GET") return json(route, path === "/api/agent/runs" ? { runs: [] } : { run });
        if (path === "/api/agent/runs") {
            const input = request.postDataJSON();
            requests.push(input);
            if (requests.length === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ msg: "测试暂时不可用" }) });
            run = { id: requests.length > 2 ? "approval-flow" : "complete-flow", conversationId: "flow-conversation", surface: "canvas", projectId: "canvas-aurora", status: requests.length > 2 ? "awaiting_approval" : "completed", prompt: input.prompt, tasks: [], referencedAssetIds: [], selectedSkillIds: [], pointsCost: 0,
                ...(requests.length > 2 ? { planApproval: { totalPoints: 12, estimated: true, steps: [{ id: "step", title: "生成主视觉", estimatedPoints: 12 }] } } : {}) };
            return json(route, { run });
        }
        if (path.endsWith("/approve")) { run = { ...run, status: "completed" }; return json(route, { run }); }
        throw new Error(`Unexpected mocked Agent action: ${path}`);
    }
    if (!["GET", "HEAD"].includes(request.method())) return json(route, { project: request.postDataJSON()?.project || {} });
    return route.continue();
});

try {
    await page.goto(`${base}/canvas/canvas-aurora`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "OAO Agent" }).click();
    const panel = page.locator(".oao-platform-agent");
    const input = panel.getByRole("textbox", { name: "创作需求" });
    await input.fill("整理当前画布为四个镜头");
    await panel.getByRole("button", { name: "发送", exact: true }).click();
    await panel.getByRole("alert").waitFor();
    check("请求失败保留输入供重试", await input.inputValue() === "整理当前画布为四个镜头");
    await panel.getByRole("button", { name: "发送", exact: true }).click();
    await page.locator('[data-node-id="agent-flow-output"]').waitFor();
    await page.waitForTimeout(500);
    check("重试复用幂等标识", requests[0].clientRequestId === requests[1].clientRequestId);
    check("请求带入当前画布快照", requests[1].surface === "canvas" && requests[1].snapshot.projectId === "canvas-aurora" && requests[1].snapshot.nodes.length > 0);
    check("事件重复回放只添加一个节点", await page.locator('[data-node-id="agent-flow-output"]').count() === 1);
    check("服务端生成动作不会在浏览器重复执行", requests.length === 2);
    await page.waitForTimeout(3200);
    check("任务结束关闭事件流而不持续重连", streamCount === 1);
    await panel.getByRole("button", { name: "新对话", exact: true }).click();
    await input.fill("生成一张主视觉");
    await panel.getByRole("button", { name: "图片", exact: true }).click();
    await panel.getByRole("button", { name: "发送", exact: true }).click();
    await panel.getByRole("button", { name: "确认并开始", exact: true }).waitFor();
    check("图片请求携带明确模型和生成意图", requests[2].preferences.mode === "image" && requests[2].modelIds.length === 1);
    check("计划确认展示预计费用", (await panel.innerText()).includes("预计 12 积分"));
    await panel.getByRole("button", { name: "确认并开始", exact: true }).click();
    await page.waitForTimeout(300);
    check("确认动作更新运行状态", await panel.getByRole("button", { name: "确认并开始", exact: true }).count() === 0 && (await panel.innerText()).includes("已完成"));
    check("没有浏览器异常", errors.length === 0);
    console.log(`CANVAS_AGENT_FLOW_OK ${checks}`);
} finally { await browser.close(); }
