/**
 * 账户数据协调器的单元验收（纯逻辑，不依赖浏览器）。
 *
 * 这里验证本轮修复的核心契约：**旧账号的迟到响应不得写入新账号数据**。
 * 用 `node --test` 运行：`node --test tests/account-data-sync.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 直接加载 TypeScript 源码在本环境不可行（无 ts 运行时），
 * 因此这里用**同样的实现语义**复刻一份最小模型来验证契约，
 * 并额外断言真实源码确实包含这些机制（防止实现被改回布尔 active）。
 */
const SOURCE = readFileSync(resolve(import.meta.dirname ?? '.', '../lib/studio/account-data-sync.ts'), 'utf8')
const HOOK_SOURCE = readFileSync(resolve(import.meta.dirname ?? '.', '../lib/studio/use-account-data.ts'), 'utf8')
const STORE_SOURCE = readFileSync(resolve(import.meta.dirname ?? '.', '../lib/studio/generation-store.tsx'), 'utf8')

/** 复刻 `createWriteGuard` 的语义，用于验证「过期令牌必须失效」。 */
function createGuard() {
  let issued = 0
  let epoch = 0
  return {
    begin(explicitEpoch = epoch) { issued += 1; return { id: issued, epoch: explicitEpoch } },
    isCurrent(token) { return token.id === issued && token.epoch === epoch },
    invalidate() { issued += 1 },
    bumpEpoch() { epoch += 1 },
  }
}

test('过期请求的响应必须被丢弃（后发的请求先返回）', () => {
  const guard = createGuard()
  const first = guard.begin()
  const second = guard.begin()
  // 第一个请求姗姗来迟：它已经不是最新一次请求，必须丢弃。
  assert.equal(guard.isCurrent(first), false, '旧令牌必须失效')
  assert.equal(guard.isCurrent(second), true, '最新令牌必须有效')
})

test('账号切换后，切换前发出的请求必须全部失效', () => {
  const guard = createGuard()
  const inFlight = guard.begin()
  assert.equal(guard.isCurrent(inFlight), true)
  // 账号切换：推进世代。
  guard.bumpEpoch()
  assert.equal(guard.isCurrent(inFlight), false, '跨账号世代的响应必须丢弃')
})

test('清理（卸载）后，在途请求不得再写入', () => {
  const guard = createGuard()
  const inFlight = guard.begin()
  guard.invalidate()
  assert.equal(guard.isCurrent(inFlight), false, 'invalidate 之后旧令牌必须失效')
})

test('布尔 active 无法表达「跨账号世代」，因此实现不能再退回布尔值', () => {
  /**
   * 反例说明为什么必须用世代令牌：
   * A 请求 → 切到 B（active=false）→ 切回 A（active=true）→ A 的旧响应返回。
   * 此时布尔值是 true，旧响应会被写进界面 —— 这正是要修的竞态。
   */
  let active = true
  const aRequestStartedWhile = active
  active = false // 切到 B
  active = true  // 切回 A
  assert.equal(active && aRequestStartedWhile, true, '布尔值无法区分这是旧响应')
})

test('真实实现包含世代令牌与守卫（防止回退成布尔 active）', () => {
  assert.match(SOURCE, /accountDataEpoch/, 'account-data-sync 必须暴露世代读取')
  assert.match(SOURCE, /bumpAccountData/, 'account-data-sync 必须提供广播入口')
  assert.match(SOURCE, /createWriteGuard/, 'account-data-sync 必须提供写入守卫')
  assert.match(SOURCE, /token\.id === issued && token\.epoch === currentEpoch/, '守卫必须同时校验请求序号与世代')
})

test('所有账户数据 hooks 都使用守卫而不是 activeRef 布尔值', () => {
  assert.match(HOOK_SOURCE, /createWriteGuard/, 'hooks 必须使用写入守卫')
  // 只能出现在说明注释里，不能真的用它做竞态判断。
  assert.doesNotMatch(HOOK_SOURCE, /activeRef\.current/, 'hooks 不应再用 activeRef.current 防竞态')
  assert.doesNotMatch(HOOK_SOURCE, /const activeRef = useRef/, 'hooks 不应再声明 activeRef')
  assert.match(HOOK_SOURCE, /useAccountDataRevision/, 'hooks 必须订阅统一刷新信号')
  // 六个数据源（作品/历史/流水/邀请/订单/素材）都要订阅刷新。
  const subscribed = (HOOK_SOURCE.match(/useAccountDataRevision\(\)/g) ?? []).length
  assert.ok(subscribed >= 6, `应有至少 6 个数据源订阅刷新，实际 ${subscribed}`)
})

test('账号切换与任务结束都会广播账户数据变化', () => {
  assert.match(STORE_SOURCE, /bumpAccountData\(\)/, 'generation-store 必须广播账户数据变化')
  // 任务结束时（活跃数下降或出现新成功结果）触发同步。
  assert.match(STORE_SOURCE, /settled|produced/, '必须区分「任务结束」与「产出新结果」两种情况')
})
