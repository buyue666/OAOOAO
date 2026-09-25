/**
 * 商品保存前的**差异确认**。
 *
 * 背景：商品编辑器字段很多（名称、价格、积分、有效期、档位、配色、权益四组…），
 * 运营点「保存商品」时很难确认自己到底改了什么、有没有误改价格或权限类字段。
 * 尤其是**价格**与**下架**这类字段，误改会直接影响收入或用户可见性。
 *
 * 这里把「草稿相对原始商品的差异」算成人类可读的条目，供保存前确认框展示：
 * - 只列**真正变化**的字段，不列未改的；
 * - 标注差异是否属于「敏感变更」（价格/上下架/积分/有效期/权益），
 *   敏感变更在确认框里额外强调，避免顺手点过。
 */

import { draftToPayload, linesToList, type ProductDraft } from './product-draft'

export type DraftDiffEntry = {
  /** 稳定标识，供界面与测试定位。 */
  field: string
  label: string
  before: string
  after: string
  /** 价格、上下架、积分、有效期、权益等会直接影响收入或用户可见性的字段。 */
  sensitive: boolean
}

const AMOUNT_FIELDS = ['amountCents', 'pointsAmount', 'dailyPoints', 'periodDays'] as const

function money(cents: number, currency: string) {
  const symbol = currency === 'USD' ? '$' : currency && currency !== 'CNY' ? `${currency} ` : '¥'
  return `${symbol}${(Number(cents || 0) / 100).toFixed(2)}`
}

function boolText(value: unknown) {
  return value ? '是' : '否'
}

function listText(value: unknown) {
  const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return list.length ? list.join('、') : '（空）'
}

/** 比较两个草稿并产出差异条目。字段顺序与编辑器一致，便于对照。 */
export function diffProductDraft(before: ProductDraft, after: ProductDraft): DraftDiffEntry[] {
  const entries: DraftDiffEntry[] = []
  const push = (field: string, label: string, previous: unknown, next: unknown, sensitive = false) => {
    const left = typeof previous === 'string' ? previous : JSON.stringify(previous ?? null)
    const right = typeof next === 'string' ? next : JSON.stringify(next ?? null)
    if (left === right) return
    entries.push({ field, label, before: String(previous ?? '（空）'), after: String(next ?? '（空）'), sensitive })
  }

  push('name', '商品名称', before.name, after.name)
  push('productKind', '商品类型', before.productKind === 'plan' ? '订阅套餐' : '积分包', after.productKind === 'plan' ? '订阅套餐' : '积分包')
  // 价格与积分属于敏感变更：直接影响收入与用户到手额度。
  push('amountCents', '日常价', money(before.amountCents, before.currency), money(after.amountCents, after.currency), true)
  push('currency', '币种', before.currency, after.currency, true)
  push('pointsAmount', '一次发放积分', before.pointsAmount, after.pointsAmount, true)
  push('dailyPoints', '每日积分', before.dailyPoints, after.dailyPoints, true)
  push('periodDays', '有效期（天）', before.periodDays, after.periodDays, true)
  push('description', '商品说明', before.description, after.description)
  push('sortOrder', '显示顺序', before.sortOrder, after.sortOrder)
  // 上下架是敏感变更：下架会立刻让用户看不到该商品。
  push('enabled', '上架状态', boolText(before.enabled), boolText(after.enabled), true)

  const displayLabels: Array<[keyof ProductDraft['display'], string, boolean]> = [
    ['name', '套餐显示名称', false],
    ['audience', '会员类型', false],
    ['groupId', '套餐分组标识', false],
    ['tone', '配色', false],
    ['tierId', '积分档位标识', false],
    ['tierLabel', '档位名称', false],
    ['badge', '活动角标', false],
    ['generationSummary', '生成量说明', false],
    // 权益分组是敏感变更：用户按权益决定买哪个套餐。
    ['benefits', '基础权益', true],
    ['promotions', '限时活动', true],
    ['exclusiveBenefits', '独家功能', true],
    ['extraBenefits', '更多权益', true],
  ]
  for (const [key, label, sensitive] of displayLabels) {
    const previous = before.display[key]
    const next = after.display[key]
    if (key === 'audience') {
      push(`display.${key}`, label, previous === 'team' ? '团队版' : '创作会员', next === 'team' ? '团队版' : '创作会员', sensitive)
      continue
    }
    if (key === 'benefits' || key === 'promotions' || key === 'exclusiveBenefits' || key === 'extraBenefits') {
      push(`display.${key}`, label, listText(linesToList(String(previous ?? ''))), listText(linesToList(String(next ?? ''))), sensitive)
      continue
    }
    push(`display.${key}`, label, previous, next, sensitive)
  }

  return entries
}

/** 差异中是否包含敏感变更（价格/上下架/积分/有效期/权益）。 */
export function hasSensitiveDiff(entries: DraftDiffEntry[]): boolean {
  return entries.some((entry) => entry.sensitive)
}

/**
 * 保存请求体相对原始商品的**实际生效字段**。
 *
 * `draftToPayload` 会补默认值（例如空 tone 会被删掉），
 * 因此差异确认应基于**真正会提交的内容**，而不是表单显示值——
 * 否则会出现「确认框说改了 X，实际没提交」的偏差。
 */
export function payloadFieldsChanged(before: ProductDraft, after: ProductDraft): string[] {
  const left = draftToPayload(before) as Record<string, unknown>
  const right = draftToPayload(after) as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  const changed: string[] = []
  for (const key of keys) {
    if (JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null)) changed.push(key)
  }
  return changed.sort()
}
