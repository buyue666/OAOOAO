/**
 * 「已选参考素材」的独立存储（纯函数，可单独测试）。
 *
 * 为什么需要它（本轮复现的真实缺陷）：
 * 此前已选只存 **id**，提交时再从「当前候选池」里按 id 查地址。
 * 而候选池是**搜索结果**驱动的 —— 搜索 B 时 A 不在结果里，
 * 于是 A 的地址查不到、`references` 变空，图片生成请求不再携带 A。
 * 界面上「已选 1」也变成「已选 0」。
 *
 * 根本错误在于把两件不同的事混成了一件：
 *   - **候选列表**：由搜索结果决定，是"给你挑的"；
 *   - **已选集合**：由用户点击决定，是"你挑中的"。
 * 素材不在搜索结果里，**不代表**它被删除或不属于当前用户。
 *
 * 因此这里存的是选中素材的**完整快照**（id + 标题 + 媒体地址 + 类型），
 * 而不是只存 id：
 *   1. 解析提交参数时不再依赖候选池 → 搜索/空结果/分页都影响不到它；
 *   2. 顺序被保留（视频首尾帧、多参考图的顺序有语义）；
 *   3. 只有三种情况会移除：用户主动取消、超出模型上限、**确认已删除**。
 */
import type { GenerationReference } from './generation-types'
import { isSubmittableReferenceUrl } from './reference-assets'

/** 已选参考素材的最小快照：足够独立解析出提交参数，不依赖任何候选池。 */
export type SelectedReference = {
  id: string
  title: string
  /** 媒体地址。选中时就固化下来，之后搜索/分页变化都不影响。 */
  src: string
  /** 素材类型（image / video / scene…），决定提交时的 `type` 与角色可用性。 */
  kind: string
}

export type SelectionSource = {
  id: string
  title: string
  src: string
  kind: string
}

/** 候选素材 → 已选快照。没有可用地址的素材不进入已选（提交不出去）。 */
export function toSelectedReference(asset: SelectionSource): SelectedReference | null {
  const src = (asset.src ?? '').trim()
  if (!isSubmittableReferenceUrl(src)) return null
  return { id: asset.id, title: asset.title, src, kind: asset.kind }
}

/**
 * 加入已选（保留顺序、按 id 去重、按上限截断）。
 *
 * 已在集合里时**刷新快照**而不是忽略：素材可能在别处被重新上传/换了地址，
 * 以最新一次选择的地址为准更符合直觉。
 */
export function addSelection(
  current: readonly SelectedReference[],
  asset: SelectionSource,
  max: number,
): SelectedReference[] {
  const next = toSelectedReference(asset)
  if (!next) return [...current]
  const limit = Math.max(0, max)
  if (limit === 0) return [...current]
  const without = current.filter((item) => item.id !== next.id)
  return [...without, next].slice(-limit)
}

/** 切换已选状态：已选则移除，未选则加入。 */
export function toggleSelection(
  current: readonly SelectedReference[],
  asset: SelectionSource,
  max: number,
): SelectedReference[] {
  if (current.some((item) => item.id === asset.id)) {
    return current.filter((item) => item.id !== asset.id)
  }
  return addSelection(current, asset, max)
}

/** 按 id 移除（用户主动取消）。 */
export function removeSelection(current: readonly SelectedReference[], id: string): SelectedReference[] {
  return current.filter((item) => item.id !== id)
}

/**
 * 按模型上限收缩。
 *
 * 返回被移除的条目，调用方据此**如实提示**"因模型上限移除了 N 张"，
 * 而不是静默丢弃（用户会以为选择丢了）。
 * 从尾部截断：保留先选的，与 `addSelection` 的 `slice(-limit)` 语义一致。
 */
export function clampSelections(
  current: readonly SelectedReference[],
  max: number,
): { next: SelectedReference[]; removed: SelectedReference[] } {
  const limit = Math.max(0, max)
  if (limit === 0) return { next: [], removed: [...current] }
  if (current.length <= limit) return { next: [...current], removed: [] }
  return { next: current.slice(-limit), removed: current.slice(0, current.length - limit) }
}

/**
 * 只保留**仍然存在**的素材（用于"素材被真正删除"的场景）。
 *
 * 关键约束：`liveIds` 必须来自**未经搜索过滤**的完整列表。
 * 用搜索结果当存活依据，正是本轮缺陷的成因。
 * 传 `undefined` 表示"暂时拿不到完整列表" → 一律保留，
 * 宁可留着让用户自己取消，也不误删。
 *
 * @deprecated 新代码请用 `reconcileWithSources`：它能区分素材库与生成作品两个来源，
 * 而本函数只有一个 id 集合，无法表达"这个 id 属于哪个来源"，
 * 拿它去校验生成作品会把"作品仍在候选列表里"误判成已删除。
 */
export function reconcileWithLive(
  current: readonly SelectedReference[],
  liveIds: ReadonlySet<string> | undefined,
): { next: SelectedReference[]; removed: SelectedReference[] } {
  if (!liveIds) return { next: [...current], removed: [] }
  const next = current.filter((item) => liveIds.has(item.id))
  const removed = current.filter((item) => !liveIds.has(item.id))
  return { next, removed }
}

/* ------------------------------------------------------------------ *
 * 按来源区分的存活判定（本轮修复）
 * ------------------------------------------------------------------ */

/**
 * 已选素材的**来源**。
 *
 * 候选池由两个**互相独立**的数据源合并而成：
 *  - `library`：素材库（用户上传的持久素材，`/api/library-assets`）；
 *  - `work`：生成结果（`/api/generation-logs` 里成功且有产物的记录）。
 *
 * 为什么必须区分：一个来源的 id 集合**不能**用来判定另一个来源是否被删除。
 * 生成作品根本不在素材库里，拿素材库的 id 集合去校验它，
 * 会把"作品还在候选列表里"误判成"已删除"（本轮缺陷之一）。
 */
export type SelectionSourceKind = 'library' | 'work'

/** 生成结果的 id 前缀（见 `workToReferenceAsset`：`generated-<work.id>`）。 */
export const WORK_ID_PREFIX = 'generated-'

/** 由已选条目的 id 判断它来自哪个来源。 */
export function selectionSourceOf(item: Pick<SelectedReference, 'id'>): SelectionSourceKind {
  return item.id.startsWith(WORK_ID_PREFIX) ? 'work' : 'library'
}

/**
 * 某一个来源的**完整**存活证据。
 *
 * `status` 的三态是这套判定的核心：
 *  - `complete`：确实取到了该来源**当前账号下的完整列表** → 可据此判定删除；
 *  - `unavailable`：分页不完整 / 请求失败 / 超时 / 未登录 → **不得**判定删除；
 *  - `empty`：取全了但一条都没有 → 仍可判定删除（用户确实清空了）。
 *
 * 早先的实现没有"完整性"这个概念：只取第一页（后端把 pageSize 限制在 100）
 * 就当全集，于是一旦素材超过 100 条，第 101 条之后全被误判为已删除。
 */
export type LiveSourceEvidence = {
  status: 'complete' | 'unavailable' | 'empty'
  /** 仅当 `status` 为 `complete` / `empty` 时有意义：**确认存在**的 id。 */
  ids: ReadonlySet<string>
  /**
   * 本次证据**覆盖的查询范围**（本轮新增，是本轮缺陷的核心）。
   *
   *  - `'all'`：读的是该来源的**全集**（逐页读全）。范围之外的条目在本来源里
   *    确实不存在 → 「不在 `ids` 里」即可判定为已删除；
   *  - 显式集合：只做了**定向**查询（例如只校验"当时已选的那几个 id"）。
   *    集合之外**根本没有查询过**，"没查到"不等于"不存在"
   *    → **不得**据此判定删除。
   *
   * 缺了这一层就会出本轮复现的缺陷：
   * 刷新开始时只选了 A，于是作品校验只查了 A（范围={A}）；
   * 刷新期间用户又选了 B，旧证据被应用到 `[A, B]`，
   * `B ∉ {A}` 被误读成"B 已删除"，B 被清掉、提交也不再携带它。
   */
  scope: ReadonlySet<string> | 'all'
}

const UNAVAILABLE_EVIDENCE: LiveSourceEvidence = { status: 'unavailable', ids: new Set<string>(), scope: new Set<string>() }

/** 拿不到完整证据（分页不全 / 请求失败 / 未登录）时的统一返回值。 */
export function unavailableEvidence(): LiveSourceEvidence {
  return UNAVAILABLE_EVIDENCE
}

/** 取全了某个来源的**全集**。空列表返回 `empty` —— 那是"确实一条都没有"，仍可判定删除。 */
export function completeEvidence(ids: Iterable<string>): LiveSourceEvidence {
  const set = new Set(ids)
  return { status: set.size ? 'complete' : 'empty', ids: set, scope: 'all' }
}

/**
 * **定向**校验的证据：只查询了 `queried` 这些 id，其中 `found` 仍然存在。
 *
 * `queried` 之外的条目属于「尚未确认」——`reconcileWithSources` 会保留它们。
 */
export function scopedEvidence(queried: Iterable<string>, found: Iterable<string>): LiveSourceEvidence {
  return { status: 'complete', ids: new Set(found), scope: new Set(queried) }
}

/** 该证据是否覆盖了这个 id（`'all'` 表示覆盖全集）。 */
export function evidenceCovers(evidence: LiveSourceEvidence | undefined, id: string): boolean {
  if (!evidence) return false
  if (evidence.status !== 'complete' && evidence.status !== 'empty') return false
  return evidence.scope === 'all' || evidence.scope.has(id)
}

/**
 * 按**来源**分别校验已选素材是否仍然存在。
 *
 * 关键约束（每一条都对应一个真实缺陷）：
 *  1. 只对**取得了完整证据**的来源做删除判定；证据不可用 → 一律保留；
 *  2. 只校验**已选中的条目** —— 未选中的素材不需要存活证据，
 *     因此切换搜索词**不会**触发整库遍历；
 *  3. 每个来源各查各的，绝不交叉判定；
 *  4. **只在证据覆盖到的范围内**判定删除（本轮新增）：
 *     定向查询只回答了"被查询的那些 id 在不在"，
 *     对范围之外的新选择**什么都没说** → 必须保留为"尚未确认"。
 *     否则"刷新期间新选的 B"会被旧证据误判成已删除。
 *
 * 返回被移除的条目与被跳过的条目，调用方据此**如实提示**
 * （而不是静默丢弃，也不是把"没查过"说成"已删除"）。
 */
export function reconcileWithSources(
  current: readonly SelectedReference[],
  evidence: { library?: LiveSourceEvidence; work?: LiveSourceEvidence },
): { next: SelectedReference[]; removed: SelectedReference[]; unverified: SelectedReference[] } {
  const next: SelectedReference[] = []
  const removed: SelectedReference[] = []
  const unverified: SelectedReference[] = []
  for (const item of current) {
    const source = selectionSourceOf(item)
    const proof = source === 'work' ? evidence.work : evidence.library
    const verifiable = proof?.status === 'complete' || proof?.status === 'empty'
    if (!verifiable) { next.push(item); continue }
    /** 证据没覆盖到这个 id（定向查询范围之外）→ 保留，并标记为"尚未确认"。 */
    if (!evidenceCovers(proof, item.id)) { next.push(item); unverified.push(item); continue }
    if (proof.ids.has(item.id)) next.push(item)
    else removed.push(item)
  }
  return { next, removed, unverified }
}

/* ------------------------------------------------------------------ *
 * 一轮校验的结果汇总（本轮修复 P3）
 * ------------------------------------------------------------------ */

/** 来源的中文名，只用于提示文案。 */
function sourceLabel(source: SelectionSourceKind): string {
  return source === 'work' ? '生成作品' : '素材库'
}

export type ReconcileReport = {
  /** 判定"已删除"并移除的条目。 */
  removed: SelectedReference[]
  /** 证据没覆盖到、仍保留但**尚未确认**的条目。 */
  unverified: SelectedReference[]
  /** 证据不可用（加载中/失败/分页不完整/未登录）而**整源未确认**的来源。 */
  unavailableSources: SelectionSourceKind[]
}

/** 空的汇总结果。 */
export function emptyReport(): ReconcileReport {
  return { removed: [], unverified: [], unavailableSources: [] }
}

/**
 * 合并同一轮里的多次校验结果（去重）。
 *
 * 为什么需要合并：一轮校验移除条目后，**已选变化会再触发一次校验**
 * （针对剩下那些条目）。若第二次的结果直接替换第一次的通知，
 * 用户就再也看不到"刚刚移除了什么" —— 实测表现为
 * "素材库确认已删除 + 生成作品 503"时只剩"生成作品未确认"，删除信息被吃掉。
 */
export function mergeReports(base: ReconcileReport, next: ReconcileReport): ReconcileReport {
  const removed = [...base.removed]
  const removedIds = new Set(removed.map((item) => item.id))
  for (const item of next.removed) if (!removedIds.has(item.id)) { removedIds.add(item.id); removed.push(item) }
  const unverified = [...base.unverified]
  const unverifiedIds = new Set(unverified.map((item) => item.id))
  for (const item of next.unverified) if (!unverifiedIds.has(item.id)) { unverifiedIds.add(item.id); unverified.push(item) }
  const unavailableSources = [...new Set([...base.unavailableSources, ...next.unavailableSources])]
  return { removed, unverified, unavailableSources }
}

/**
 * 把一轮校验的结果汇成**一条**通知文案。
 *
 * 为什么必须"一轮一条"（本轮缺陷）：
 * 早先删除提示写在 `setSelectedRefs` 的**状态更新函数**里、失败提示由
 * `refreshSources` 另外 `setNotice` —— 两者互相覆盖，用户只看到后写的那条。
 * 实测：素材库确认已删除 + 生成作品返回 503 时，只显示"已移除不存在素材"，
 * "生成作品未确认、已保留"被吃掉，用户会以为整轮都已确认。
 *
 * 这里把两类结果**合成一条**：既说明移除了什么，也说明哪些来源未确认、保留了什么。
 * 返回 `null` 表示这一轮无事可报（不覆盖既有提示）。
 */
export function describeReconcile(report: ReconcileReport): { tone: 'warning' | 'accent'; text: string } | null {
  const { removed, unverified, unavailableSources } = report
  const parts: string[] = []
  if (removed.length) {
    const bySource = new Map<SelectionSourceKind, number>()
    for (const item of removed) bySource.set(selectionSourceOf(item), (bySource.get(selectionSourceOf(item)) ?? 0) + 1)
    const detail = [...bySource.entries()].map(([source, count]) => `${sourceLabel(source)} ${count} 个`).join('、')
    parts.push(`已确认删除并从已选中移除：${detail}。`)
  }
  const pending: string[] = []
  if (unverified.length) {
    const bySource = new Map<SelectionSourceKind, number>()
    for (const item of unverified) bySource.set(selectionSourceOf(item), (bySource.get(selectionSourceOf(item)) ?? 0) + 1)
    pending.push([...bySource.entries()].map(([source, count]) => `${sourceLabel(source)} ${count} 个`).join('、'))
  }
  if (unavailableSources.length) pending.push(`${unavailableSources.map(sourceLabel).join('与')}（本次没有取到完整数据）`)
  if (pending.length) {
    parts.push(`尚未确认、已保留选择：${pending.join('；')}。请稍后重试刷新。`)
  }
  if (!parts.length) return null
  /** 只要本轮存在"删除"或"尚未确认"，都属于需要用户知晓的情况，统一用 warning。 */
  return { tone: 'warning', text: parts.join('') }
}

/**
 * 一轮存活校验的**累计器**。
 *
 * 为什么需要它：移除条目会改变已选，而"已选变化"又会触发下一次校验。
 * 于是同一次用户操作（点「刷新素材」）会分成两个批次：
 *   批次 1 → 素材库确认已删除（移除它）；
 *   批次 2 → 对剩下条目继续校验 → 生成作品 503。
 * 若批次 2 的提示直接替换批次 1，删除信息就消失了（本轮 P3 实测）。
 *
 * 因此把同一"轮"的批次结果**累计**起来，只对外给一条汇总通知。
 * 轮的边界由**用户意图**决定：手动刷新、或用户自己增删了选择 → 开新一轮；
 * 我们因判定删除而自己收缩选择 → 不算新轮（那是同一轮的后果）。
 */
export function createReconcileRound() {
  let log = emptyReport()
  let lastIds = new Set<string>()
  /** 本组件自己移除的 id：用于把"我们的收缩"与"用户取消选择"区分开。 */
  let selfPruned = new Set<string>()

  return {
    /** 记录"这些 id 是我们自己移除的"，供下一次 `begin` 判断变化来源。 */
    noteSelfPruned(ids: Iterable<string>) {
      for (const id of ids) selfPruned.add(id)
    },
    /**
     * 开启一个批次。`manual` 表示这是用户主动发起的刷新。
     * 若与上一批相比用户新增了选择、或取消了某个非我们移除的选择 → 累计清零。
     */
    begin(ids: readonly string[], options: { manual?: boolean } = {}) {
      const current = new Set(ids)
      const added = [...current].some((id) => !lastIds.has(id))
      const removedByUser = [...lastIds].some((id) => !current.has(id) && !selfPruned.has(id))
      if (options.manual || added || removedByUser) log = emptyReport()
      /** 本轮的自我移除已消费完毕，避免影响后续判断。 */
      selfPruned = new Set()
      lastIds = current
    },
    /** 累计一批结果。 */
    accumulate(report: ReconcileReport) {
      log = mergeReports(log, report)
    },
    /** 当前累计结果（用于生成汇总通知）。 */
    get() {
      return log
    },
  }
}

export type ReconcileRound = ReturnType<typeof createReconcileRound>

/** 提交给后端的参考素材结构（与 `GenerationReference` 对齐）。 */
export type ResolvedReference = { name: string; type: string; url: string; role?: GenerationReference['role'] }

/**
 * 已选快照 → 提交参数。
 *
 * 直接读快照里的地址，**不再查候选池** —— 这是本缺陷的修复要点。
 * 坏链在选中时已被挡掉（`toSelectedReference`），这里再挡一次作为兜底。
 */
export function selectionsToReferences(
  selections: readonly SelectedReference[],
  options: { max?: number; type?: (item: SelectedReference) => string; role?: GenerationReference['role'] } = {},
): ResolvedReference[] {
  const max = options.max === undefined ? Number.POSITIVE_INFINITY : Math.max(0, options.max)
  if (max === 0) return []
  const resolved: ResolvedReference[] = []
  for (const item of selections) {
    if (resolved.length >= max) break
    if (!isSubmittableReferenceUrl(item.src)) continue
    resolved.push({
      name: item.title,
      type: options.type ? options.type(item) : 'image',
      url: item.src.trim(),
      ...(options.role ? { role: options.role } : {}),
    })
  }
  return resolved
}
