/**
 * 第十二轮纯函数回归：证据的**查询范围**与**一轮汇总**。
 *
 * 这两个点是本轮两个缺陷的核心，且都是纯逻辑，
 * 因此用 Node 直接复刻语义断言（不依赖浏览器），
 * 并额外断言真实源码确实包含这些机制，防止实现被改回去。
 *
 * 运行：`node tests/selection-evidence-scope.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE = readFileSync(resolve(import.meta.dirname ?? '.', '../lib/studio/reference-selection.ts'), 'utf8')
const WORKSPACES = readFileSync(resolve(import.meta.dirname ?? '.', '../components/studio/workspaces.tsx'), 'utf8')
const HOOK_SOURCE = readFileSync(resolve(import.meta.dirname ?? '.', '../lib/studio/use-account-data.ts'), 'utf8')

const WORK_ID_PREFIX = 'generated-'
const selectionSourceOf = (item) => (item.id.startsWith(WORK_ID_PREFIX) ? 'work' : 'library')
const completeEvidence = (ids) => ({ status: ids.size ? 'complete' : 'empty', ids, scope: 'all' })
const scopedEvidence = (queried, found) => ({ status: 'complete', ids: found, scope: queried })
const unavailableEvidence = () => ({ status: 'unavailable', ids: new Set(), scope: new Set() })

function evidenceCovers(evidence, id) {
  if (!evidence) return false
  if (evidence.status !== 'complete' && evidence.status !== 'empty') return false
  return evidence.scope === 'all' || evidence.scope.has(id)
}

/** 复刻 `reconcileWithSources` 的语义。 */
function reconcile(current, evidence) {
  const next = []; const removed = []; const unverified = []
  for (const item of current) {
    const proof = selectionSourceOf(item) === 'work' ? evidence.work : evidence.library
    const verifiable = proof?.status === 'complete' || proof?.status === 'empty'
    if (!verifiable) { next.push(item); continue }
    if (!evidenceCovers(proof, item.id)) { next.push(item); unverified.push(item); continue }
    if (proof.ids.has(item.id)) next.push(item)
    else removed.push(item)
  }
  return { next, removed, unverified }
}

const sel = (id) => ({ id, title: id, src: `/api/x/${id}.png`, kind: 'image' })
const A = sel(`${WORK_ID_PREFIX}work-a`)
const B = sel(`${WORK_ID_PREFIX}work-b`)

test('定向证据只覆盖被查询的 id：范围外的选择必须保留', () => {
  /** 旧刷新开始时的选择只有 A，因此只查询了 A。 */
  const evidence = scopedEvidence(new Set([A.id]), new Set([A.id]))
  /** 刷新期间用户又选了 B —— 应用时已选是 [A, B]。 */
  const result = reconcile([A, B], { work: evidence })
  assert.equal(result.removed.length, 0, '"没有查询过 B" 绝不能被当成 "B 已删除"')
  assert.deepEqual(result.next.map((i) => i.id), [A.id, B.id], 'A、B 都必须保留')
  assert.deepEqual(result.unverified.map((i) => i.id), [B.id], 'B 应被标记为"尚未确认"')
})

test('反证：不区分查询范围时，B 会被误删（旧实现的行为）', () => {
  /** 旧实现：把证据整个应用到最新选择上，不看查询范围。 */
  const legacyReconcile = (current, evidence) => {
    const next = []; const removed = []
    for (const item of current) {
      const proof = selectionSourceOf(item) === 'work' ? evidence.work : evidence.library
      const verifiable = proof?.status === 'complete' || proof?.status === 'empty'
      if (!verifiable) { next.push(item); continue }
      if (proof.ids.has(item.id)) next.push(item)
      else removed.push(item)
    }
    return { next, removed }
  }
  const evidence = scopedEvidence(new Set([A.id]), new Set([A.id]))
  const legacy = legacyReconcile([A, B], { work: evidence })
  assert.deepEqual(legacy.removed.map((i) => i.id), [B.id], '旧实现确实会把 B 判成已删除（这正是本轮缺陷）')
  assert.deepEqual(legacy.next.map((i) => i.id), [A.id], '旧实现只剩 A —— 与实测"已选 2 变 1"一致')
})

test('全集证据（scope=all）仍可判定删除：范围内未命中的确已删除', () => {
  const evidence = completeEvidence(new Set([A.id]))
  const result = reconcile([A, B], { work: evidence })
  assert.deepEqual(result.removed.map((i) => i.id), [B.id], '读的是全集时，未命中即可判定删除')
  assert.deepEqual(result.unverified, [], '全集证据下没有"尚未确认"的条目')
})

test('证据不可用时一律保留，且不算"已确认删除"', () => {
  const result = reconcile([A, B], { work: unavailableEvidence() })
  assert.equal(result.removed.length, 0, '失败/加载中/分页不完整都不得判定删除')
  assert.equal(result.next.length, 2)
  assert.equal(result.unverified.length, 0, '整源不可用时由来源级提示负责，不逐条计入"尚未确认"')
})

test('来源互不交叉：素材库证据不得判定作品', () => {
  const lib = sel('asset-1')
  /** 素材库全集里没有这个作品 id —— 但它是 work 来源，不该由素材库判定。 */
  const result = reconcile([A, lib], { library: completeEvidence(new Set([lib.id])) })
  assert.deepEqual(result.next.map((i) => i.id), [A.id, lib.id], '作品来源没有证据时必须保留')
  assert.equal(result.removed.length, 0)
})

/* ---------------- 一轮汇总（P3） ---------------- */

function mergeReports(base, next) {
  const removed = [...base.removed]; const removedIds = new Set(removed.map((i) => i.id))
  for (const item of next.removed) if (!removedIds.has(item.id)) { removedIds.add(item.id); removed.push(item) }
  const unverified = [...base.unverified]; const unverifiedIds = new Set(unverified.map((i) => i.id))
  for (const item of next.unverified) if (!unverifiedIds.has(item.id)) { unverifiedIds.add(item.id); unverified.push(item) }
  return { removed, unverified, unavailableSources: [...new Set([...base.unavailableSources, ...next.unavailableSources])] }
}

test('同一轮的删除与失败结果会累计，不会被后一批覆盖', () => {
  const stage1 = { removed: [sel('asset-1')], unverified: [], unavailableSources: [] }
  const stage2 = { removed: [], unverified: [], unavailableSources: ['work'] }
  const merged = mergeReports(stage1, stage2)
  assert.equal(merged.removed.length, 1, '第二批不得吃掉第一批的删除结果')
  assert.deepEqual(merged.unavailableSources, ['work'], '未确认来源也要保留')
})

test('累计结果去重：同一个 id 不会重复计入', () => {
  const merged = mergeReports(
    { removed: [sel('asset-1')], unverified: [], unavailableSources: ['work'] },
    { removed: [sel('asset-1')], unverified: [], unavailableSources: ['work'] },
  )
  assert.equal(merged.removed.length, 1)
  assert.deepEqual(merged.unavailableSources, ['work'])
})

test('真实实现包含本轮的两个核心机制（防止回退）', () => {
  assert.match(SOURCE, /export function scopedEvidence/, '必须有"定向证据"构造函数')
  assert.match(SOURCE, /scope: ReadonlySet<string> \| 'all'/, '证据必须携带查询范围')
  assert.match(SOURCE, /export function evidenceCovers/, '必须有范围覆盖判断')
  assert.match(SOURCE, /export function createReconcileRound/, '必须有"一轮汇总"累计器')
  assert.match(SOURCE, /export function mergeReports/, '必须有轮内结果合并')
  assert.match(SOURCE, /export function describeReconcile/, '必须有汇总通知文案')
  assert.match(HOOK_SOURCE, /scopedEvidence\(ids, result\.found\)/, '定向作品校验必须声明查询范围')
  assert.match(WORKSPACES, /verifyBatchRef/, '工作台必须有校验批次号')
  assert.match(WORKSPACES, /isBatchCurrent/, '组合结果应用前必须核对批次')
  assert.match(WORKSPACES, /createReconcileRound/, '工作台必须使用一轮汇总')
})

test('状态更新函数里不得再出现通知等副作用（P3 的根因）', () => {
  /**
   * 只检查 `applyEvidence` 与两处收缩 effect：它们的 updater 必须只做纯过滤。
   * 允许其它与存活判定无关的 updater（如上传队列）保持原样。
   */
  const updaters = WORKSPACES.match(/set(SelectedRefs|FirstFrameRef|LastFrameRef|SourceVideoRef)\(\(current\) => \{[\s\S]*?\n\s*\}\)/g) ?? []
  assert.ok(updaters.length > 0, '应能匹配到已选集合的状态更新函数')
  for (const block of updaters) {
    assert.doesNotMatch(block, /setNotice\(/, '状态更新函数里不得调用 setNotice（会产生副作用并互相覆盖）')
  }
})
