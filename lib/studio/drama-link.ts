/**
 * 画布项目 ↔ 短剧项目的关联解析。
 *
 * 背景（本轮复现的真实缺陷）：
 * 剧本页与分镜页是**从画布项目**进入的（`/projects/<canvasProjectId>/script`），
 * 而真正承载剧本、分镜与生成结果的是**短剧项目**（`/api/drama/projects/<dramaId>`）。
 * 两者是**不同的命名空间、不同的表**，id 不能互相充当对方：
 *
 * ```text
 * GET /api/canvas/projects  → canvas-cHXB96S-WQfIfgMnaOP6k、canvas-aurora、canvas-drama-drama-SEzZ-...-episode-FPMyp...
 * GET /api/drama/projects   → drama-SEzZ-MYSkXDT8G3cJ-2g7
 * ```
 *
 * 把画布 id 直接传给短剧接口只会 404（`画布项目不存在`），
 * 因此必须先解析出真正的短剧 id。
 *
 * 关联规则来自后端自身（`web/src/lib/drama-canvas-link.ts` 与两个 service）：
 *
 * ```text
 * dramaCanvasHandoffId(projectId, episodeId) = `drama-${projectId}-${episodeId}`  // 截断到 160 字符
 * dramaCanvasProjectId(projectId, episodeId) = `canvas-${dramaCanvasHandoffId(...)}`
 * canvas-project-service: id = `canvas-${sourceHandoffId}` 或 `canvas-${nanoid()}`
 * drama-project-service:  id = `drama-${sourceHandoffId}`  或 `drama-${nanoid()}`
 * ```
 *
 * 也就是说：画布 id 去掉 `canvas-` 前缀后得到的 handoff，等于短剧侧送画布时
 * 写入的 `drama-${projectId}-${episodeId}`（或等于短剧 id 本身，当画布是由短剧 id 作 handoff 创建时）。
 *
 * **不能盲目切分 handoff**：`projectId` 与 `episodeId` 自身都含 `-`，
 * 后端 `drama-canvas-link.ts` 明确写了这一点（“切分本质上有歧义”）。
 * 因此这里改为**在已知的真实短剧 id 集合里做匹配**（判定见 `matchesDramaProject`），
 * 多个候选时取最长的一个，这样 `drama-a` 不会错误地抢走 `drama-a-b-...` 的匹配。
 *
 * 下面是本仓库实测过的真实 id（同一账号）：
 *
 * ```text
 * 画布 canvas-drama-drama-SEzZ-MYSkXDT8G3cJ-2g7-episode-FPMypfkUlh1lbDumDj4mU
 * 短剧 drama-SEzZ-MYSkXDT8G3cJ-2g7                        ← handoff = drama-<短剧 id>-<分集 id>
 * 画布 canvas-aurora → handoff "aurora"                   ← 无匹配，如实返回 null
 * ```
 */

/** 画布项目 id 前缀（与后端 `canvas-project-service` 的生成规则一致）。 */
const CANVAS_PREFIX = 'canvas-'

/** 短剧项目 id 前缀（与后端 `drama-project-service` 的生成规则一致）。 */
const DRAMA_PREFIX = 'drama-'

/**
 * 单个短剧项目是否与画布 handoff 对应。
 *
 * 四条规则都来自后端源码与线上真实数据，缺一不可：
 *
 * 1. `handoff.startsWith(`${dramaProjectId}-`)`——短剧 id 是 handoff 的前缀
 *    （画布直接以短剧 id 作 handoff 创建时的形状）。
 * 2. `handoff.startsWith(`drama-${dramaProjectId}-`)`——后端
 *    `dramaCanvasHandoffId` 的原始形状 `drama-${projectId}-${episodeId}`。
 *    短剧 id 自身就以 `drama-` 开头，于是线上真实 handoff 是
 *    `drama-drama-<nanoid>-episode-<nanoid>`。**这是最主要的一条**，
 *    少了它真实项目全部会被判成「无关联」（实测：`canvas-drama-drama-SEzZ-…-episode-…`
 *    解析不到 `drama-SEzZ-MYSkXDT8G3cJ-2g7`）。
 * 3. `handoff === dramaProjectId`——画布以短剧 id 为 handoff 创建。
 * 4. `dramaProjectId === `drama-${handoff}``——**画布先建、短剧后建**的方向：
 *    由画布发起创建短剧时传 `sourceHandoffId = <画布 id 去掉 canvas->`，
 *    后端把短剧 id 生成为 `drama-${sourceHandoffId}`，于是画布是 `canvas-H`、
 *    短剧是 `drama-H`。这正是本项目「创建并关联短剧项目」按钮走的路径，
 *    漏掉它会让刚建立的关联立刻被判成「无关联」。
 */
export function matchesDramaProject(handoff: string, dramaProjectId: string): boolean {
  if (!handoff || !dramaProjectId) return false
  if (handoff.startsWith(`${dramaProjectId}-`)) return true
  if (handoff.startsWith(`${DRAMA_PREFIX}${dramaProjectId}-`)) return true
  if (handoff === dramaProjectId) return true
  return dramaProjectId === `${DRAMA_PREFIX}${handoff}`
}

/**
 * 由画布项目 id 还原 handoff id。
 *
 * 优先使用后端直接返回的 `sourceHandoffId`（最准确，没有歧义）；
 * 没有时才退回到「去掉 `canvas-` 前缀」，并且只在前缀确实存在时这样做——
 * 对 `canvas-aurora` 这类**没有短剧来源**的画布项目，结果 `aurora` 不会匹配任何真实短剧 id，
 * 由 `resolveLinkedDramaProjectId` 如实返回 null，而不是编造一个短剧项目。
 */
export function canvasHandoffFromProjectId(canvasProjectId: string, sourceHandoffId?: string): string {
  const explicit = typeof sourceHandoffId === 'string' ? sourceHandoffId.trim() : ''
  if (explicit) return explicit
  const id = typeof canvasProjectId === 'string' ? canvasProjectId.trim() : ''
  if (!id) return ''
  return id.startsWith(CANVAS_PREFIX) ? id.slice(CANVAS_PREFIX.length) : id
}

/**
 * 在真实短剧 id 列表中解析出与画布项目关联的那一个。
 *
 * 返回 `null` 表示「这个画布项目没有对应的短剧项目」——这是**正常状态**，
 * 不是错误，也不能因此凭空创建一个短剧项目（`canvas-aurora`、`回归项目-*` 都属于这一类）。
 */
export function resolveLinkedDramaProjectId(canvasProjectId: string, dramaProjectIds: readonly string[], sourceHandoffId?: string): string | null {
  const handoff = canvasHandoffFromProjectId(canvasProjectId, sourceHandoffId)
  if (!handoff) return null
  let matched: string | null = null
  for (const candidate of dramaProjectIds) {
    const id = typeof candidate === 'string' ? candidate.trim() : ''
    if (!matchesDramaProject(handoff, id)) continue
    // 最长匹配：避免较短的 id 抢先命中更长的真实项目。
    if (!matched || id.length > matched.length) matched = id
  }
  return matched
}

/** 由短剧项目与分集推导短剧侧会送往画布的 handoff id（与后端同一规则）。 */
export function dramaCanvasHandoffId(dramaProjectId: string, episodeId?: string): string {
  const project = String(dramaProjectId || '').trim()
  const episode = String(episodeId || '').trim()
  if (!project) return ''
  if (!episode) return project.slice(0, 160)
  return `drama-${project}-${episode}`.slice(0, 160)
}

/**
 * 由短剧项目 id 还原它对应的画布项目 id。
 *
 * 用途：在剧本页给出「打开对应画布」的入口时，必须指向**真正的画布 id**。
 * 与 `resolveLinkedDramaProjectId` 相反：这里由短剧推导画布，
 * 同样只做前缀拼接，不猜测、不发明 id。
 */
export function canvasProjectIdFromHandoff(handoffId: string): string {
  const handoff = String(handoffId || '').trim()
  return handoff ? `${CANVAS_PREFIX}${handoff}` : ''
}
