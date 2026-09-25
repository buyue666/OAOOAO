/**
 * 模型别名的编辑逻辑：与后端 `model-routing-config.ts` 同一套规则。
 *
 * 背景：逻辑模型只有 4 个字段（`id` / `name` / `capability` / `enabled` / `bindings`），
 * 没有别名。`name` 只影响界面展示（实测把 `e2e-image` 的 name 改成
 * 「OAOOAO 图片模型」后，工作台下拉显示新名字，但**请求仍然只能用 `id`**：
 * 用 `e2e-image` 请求 → 200，用显示名称请求 → 400「任务参数不完整」）。
 * 于是「对外想暴露一个更好记的名字、或兼容旧模型名」时必须改 `id`，
 * 而 `id` 被已有任务、计价键 `modelPointCosts`、默认模型引用着，改它风险很高。
 *
 * 别名用来解决这件事：`id` 不动，额外提供可请求的名字。
 */

export type ModelWithAliases = {
  id: string
  name?: string
  aliases?: string[]
}

/** 与后端一致：忽略 `models/` 前缀与大小写。 */
export function normalizeModelKey(value: string): string {
  return String(value || '').trim().replace(/^models\//i, '').toLowerCase()
}

/** 该模型的全部可请求名字：`id` 加别名。 */
export function requestNamesOf(model: ModelWithAliases): string[] {
  return [model.id, ...(model.aliases ?? [])].map((item) => String(item || '').trim()).filter(Boolean)
}

/**
 * 别名清洗：去空、去首尾空格、去重（忽略大小写）、去与自身 `id` 重复。
 *
 * 不清洗会在保存后出现「输入框里有 3 个但列表只显示 1 个」的错觉，
 * 也会把重复值发给后端。
 */
export function normalizeAliases(value: unknown, id: string): string[] {
  if (!Array.isArray(value)) return []
  const modelKey = normalizeModelKey(id)
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const item of value) {
    const alias = String(item ?? '').trim()
    if (!alias) continue
    const key = normalizeModelKey(alias)
    if (!key || key === modelKey || seen.has(key)) continue
    seen.add(key)
    aliases.push(alias)
    if (aliases.length >= 20) break
  }
  return aliases
}

/**
 * 别名校验：与后端 `logicalModelAliasConflicts` 同一规则。
 *
 * 别名撞到**任何**逻辑模型的 `id` 或别名都会让同一个请求名指向两个模型，
 * 解析结果取决于数组顺序 —— 必须提前拦住，而不是等保存后行为随机。
 */
export function validateAlias(input: {
  alias: string
  /** 正在编辑的模型 id。 */
  modelId: string
  /** 同模型内已有的其它别名（用于查重）。 */
  siblings?: string[]
  models: ModelWithAliases[]
}): string | null {
  const alias = input.alias.trim()
  if (!alias) return '别名不能为空'
  if (alias.length > 120) return '别名不能超过 120 个字符'
  if (!/^[\w.\-/:@]+$/.test(alias)) return '别名只能包含字母、数字与 . - _ / : @'
  const key = normalizeModelKey(alias)
  const modelKey = normalizeModelKey(input.modelId)
  if (key === modelKey) return `别名不能与模型标识相同（${input.modelId}）`
  if ((input.siblings ?? []).some((item) => normalizeModelKey(item) === key)) return `该模型已有别名 ${alias}`
  for (const model of input.models) {
    if (normalizeModelKey(model.id) === modelKey) continue
    if (normalizeModelKey(model.id) === key) return `别名 ${alias} 已被逻辑模型标识 ${model.id} 占用`
    const conflict = (model.aliases ?? []).find((item) => normalizeModelKey(item) === key)
    if (conflict) return `别名 ${alias} 已被逻辑模型 ${model.id} 使用`
  }
  return null
}

/** 整个模型的别名汇总校验（保存前统一检查）。 */
export function collectAliasIssues(models: ModelWithAliases[]): string[] {
  const issues: string[] = []
  const owner = new Map<string, { modelId: string; name: string; isAlias: boolean }>()
  const claim = (modelId: string, name: string, isAlias: boolean) => {
    const key = normalizeModelKey(name)
    if (!key) return
    const existing = owner.get(key)
    if (existing && existing.modelId.toLowerCase() !== modelId.toLowerCase()) {
      issues.push(`「${name}」同时被逻辑模型 ${existing.modelId} 与 ${modelId} 使用，请求解析结果将不确定`)
      return
    }
    if (!existing) owner.set(key, { modelId, name, isAlias })
  }
  for (const model of models) claim(model.id, model.id, false)
  for (const model of models) for (const alias of model.aliases ?? []) claim(model.id, alias, true)
  return Array.from(new Set(issues))
}

/** 别名以逗号或换行分隔输入，便于一次填多个。 */
export function parseAliasInput(value: string): string[] {
  return value.split(/[,\n，]/).map((item) => item.trim()).filter(Boolean)
}

export function formatAliasInput(aliases: string[] | undefined): string {
  return (aliases ?? []).join('，')
}
