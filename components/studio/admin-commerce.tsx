'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BadgePercent, CircleDollarSign, Copy, Gift, Hourglass, Pencil, Plus, RefreshCw, RotateCcw, Save, Ticket, Users } from 'lucide-react'
import {
  closeBillingOrder,
  completeBillingOrder,
  createBillingProduct,
  deletePromotion,
  duplicateBillingProduct,
  getFinanceSummary,
  getReferralOverview,
  grantCoupon,
  listBillingOrders,
  listBillingProducts,
  listCouponTemplates,
  listPromotions,
  listReferralRelationships,
  listReferralRewards,
  refundBillingOrder,
  saveCouponTemplate,
  savePromotion,
  updateBillingProduct,
  updatePromotion,
  updateReferralProgram,
  type Paged,
} from '@/lib/studio/admin-api'
import type { BillingOrder, BillingProduct, CouponTemplate, FinanceSummary, PromotionCampaign, ReferralOverview, ReferralRelationship, ReferralReward } from '@/lib/studio/admin-types'
import { discountLabelOf, objectValue, tones } from '@/lib/studio/membership'
import { draftToPayload, emptyDraft, linesToList, productToDraft, resolvePreviewPricing, resolvePromotionForAmount, validateDraft, type ProductDraft } from '@/lib/studio/product-draft'
import { buildPromotionPayload, buildPromotionRemoval, findPromotionForProduct, promotionAmountFor, validatePromotionAmount } from '@/lib/studio/promotion-draft'
import { diffProductDraft, hasSensitiveDiff, type DraftDiffEntry } from '@/lib/studio/product-diff'
import { StudioApiError } from '@/lib/studio/api'
import { ProductPreviewPanel } from './product-preview'
import { ControlButton, Modal, StatusBadge } from './ui'
import {
  AdminCell,
  AdminDefinition,
  AdminDrawer,
  AdminEmpty,
  AdminError,
  AdminField,
  AdminInput,
  AdminLoading,
  AdminNotice,
  AdminPagination,
  AdminRow,
  AdminSectionCard,
  AdminSelect,
  AdminStat,
  AdminTable,
  AdminTextarea,
  TableMessageRow,
  formatAdminDate,
  formatAdminMoney,
  formatAdminNumber,
  labelOf,
  orderStatusLabels,
  statusTone,
  useConfirm,
} from './admin-kit'
import { useAdminReload, useAdminSession } from './admin-shell'

/* --------------------------------- 商品 --------------------------------- */

export function AdminProductsPanel() {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  const canManage = session.can('commerce.manage')

  const [products, setProducts] = useState<BillingProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const [editor, setEditor] = useState<BillingProduct | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [promotions, setPromotions] = useState<PromotionCampaign[]>([])
  const [campaign, setCampaign] = useState<PromotionCampaign | 'new' | null>(null)
  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoading(true); setError('')
    Promise.all([listBillingProducts(), listPromotions().catch(() => [] as PromotionCampaign[])])
      .then(([items, campaigns]) => { setProducts(items.slice().sort((a, b) => a.sortOrder - b.sortOrder)); setPromotions(campaigns) })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '商品加载失败'))
      .finally(() => setLoading(false))
  }, [reloadKey])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback((product: BillingProduct) => {
    const disabling = product.enabled
    confirm.confirm({
      title: disabling ? `下架商品「${product.name}」？` : `上架商品「${product.name}」？`,
      description: disabling ? '下架后订阅页不再展示该商品，已产生的订单不受影响。' : '上架后商品会立即出现在订阅页可选列表中。',
      confirmLabel: disabling ? '确认下架' : '确认上架',
      tone: disabling ? 'danger' : 'default',
      onConfirm: async () => {
        setBusy(product.id)
        try {
          await updateBillingProduct(product.id, { enabled: !product.enabled })
          setMessage(disabling ? '商品已下架' : '商品已上架')
          load()
        } finally { setBusy(null) }
      },
    })
  }, [confirm, load])

  const visible = products.filter((product) => {
    if (kind && product.productKind !== kind) return false
    if (!search.trim()) return true
    return `${product.name} ${product.description || ''} ${product.planId || ''}`.toLowerCase().includes(search.trim().toLowerCase())
  })

  const planCount = products.filter((product) => product.productKind === 'plan').length
  const pointsCount = products.filter((product) => product.productKind === 'points').length

  /**
   * 同组商品展示一致性检查。
   *
   * 两类问题会让用户套餐页出现意外结果：
   * ① 同分组内的展示名称/配色/受众/权益不一致（用户看到的同一张卡会在不同周期变样）；
   * ② 同分组 + 同档位 + 同周期出现多个商品（`toMembershipPlans` 只会展示其中一个，
   *    等于静默覆盖价格）。
   * 这里只做**提示**，不静默改价，也不阻止保存。
   */
  const groupIssues = useMemo(() => {
    const groups = new Map<string, BillingProduct[]>()
    for (const product of products) {
      const display = objectValue(objectValue(product.metadata).membership)
      const groupId = typeof display.groupId === 'string' && display.groupId.trim() ? display.groupId.trim() : ''
      if (!groupId) continue
      groups.set(groupId, [...(groups.get(groupId) ?? []), product])
    }
    const issues: Array<{ groupId: string; kind: 'inconsistent' | 'duplicate'; message: string }> = []
    const cycleOf = (product: BillingProduct) => product.productKind === 'points' ? 'once' : product.periodDays >= 360 ? 'annual' : product.periodDays >= 85 && product.periodDays <= 95 ? 'quarterly' : 'monthly'
    for (const [groupId, items] of groups) {
      if (items.length < 2) continue
      // ① 展示配置不一致
      const signatures = new Set(items.map((product) => {
        const display = objectValue(objectValue(product.metadata).membership)
        return [display.name ?? '', display.tone ?? '', display.audience ?? '', JSON.stringify(display.benefits ?? [])].join('|')
      }))
      if (signatures.size > 1) {
        issues.push({ groupId, kind: 'inconsistent', message: `分组「${groupId}」的 ${items.length} 个商品展示配置不一致（名称/配色/受众/权益），同一张套餐卡在不同周期会显示不同内容。` })
      }
      // ② 同档位 + 同周期重复
      const seen = new Map<string, string[]>()
      for (const product of items) {
        const display = objectValue(objectValue(product.metadata).membership)
        const tierId = typeof display.tierId === 'string' && display.tierId.trim() ? display.tierId.trim() : 'default'
        const key = `${tierId}:${cycleOf(product)}`
        seen.set(key, [...(seen.get(key) ?? []), product.id])
      }
      for (const [key, ids] of seen) {
        if (ids.length < 2) continue
        const [tierId, cycle] = key.split(':')
        issues.push({ groupId, kind: 'duplicate', message: `分组「${groupId}」的「${tierId}」档位在 ${cycle} 周期有 ${ids.length} 个商品，用户页只会展示其中一个，请确认价格归属。` })
      }
    }
    return issues
  }, [products])

  /** 折扣由各参与商品的价格推导；多商品时逐个列出，避免只显示一个而误导运营。 */
  const campaignDiscountLabels = useCallback((item: PromotionCampaign) => item.products.map((entry) => {
    const product = products.find((candidate) => candidate.id === entry.productId)
    if (!product) return `${entry.productId.slice(0, 8)}…（商品不存在）`
    const label = discountLabelOf(product.amountCents, entry.promotionalAmountCents)
    return `${product.name} ${formatAdminMoney(entry.promotionalAmountCents, product.currency)}${label ? ` / ${label}` : ' / 无折扣'}`
  }), [products])

  /** 删除活动：后端在有订单引用时会拒绝（409），错误原样显示在确认框内。 */
  /**
   * 复制商品。
   *
   * 用作「以现有套餐为模板建一个新的」——例如按月卡复制出季卡。
   * 复制出的商品**默认下架**、且落在**独立分组**：
   *  - 下架：避免刚复制出来就直接出现在用户订阅页；
   *  - 独立分组：否则会与原商品争抢同一张卡片的同档位同周期，
   *    `toMembershipPlans` 只会展示其中一个，等于静默覆盖价格。
   * 活动价不复制（活动挂在「活动 × 商品」上），避免产生运营没注意到的折扣。
   */
  const duplicate = useCallback((product: BillingProduct) => {
    confirm.confirm({
      title: `复制商品「${product.name}」？`,
      description: '将创建一个内容相同的新商品：默认下架、放在独立分组、不带活动价。你可以编辑后再上架。',
      confirmLabel: '确认复制',
      onConfirm: async () => {
        setBusy(`copy:${product.id}`)
        try {
          const created = await duplicateBillingProduct(product, `${product.name} 副本`)
          setMessage(`已复制为「${created.name}」（当前未上架，请编辑后上架）`)
          load()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : '复制商品失败')
        } finally { setBusy(null) }
      },
    })
  }, [confirm, load])

  const removeCampaign = useCallback((item: PromotionCampaign) => {
    confirm.confirm({
      title: `删除活动「${item.name}」？`,
      description: `该活动包含 ${item.products.length} 个商品的活动价，删除后这些商品恢复日常价，用户页不再显示折扣。被订单引用过的活动无法删除，可改为停用。`,
      confirmLabel: '确认删除',
      tone: 'danger',
      onConfirm: async () => {
        setBusy(`campaign:${item.id}`)
        try {
          await deletePromotion(item.id)
          setMessage(`活动「${item.name}」已删除`)
          load()
        } finally { setBusy(null) }
      },
    })
  }, [confirm, load])

  return (
    <div className="flex flex-col gap-5">
      {confirm.dialog}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStat label="商品总数" value={formatAdminNumber(products.length)} detail={`上架 ${formatAdminNumber(products.filter((p) => p.enabled).length)}`} />
        <AdminStat label="订阅套餐" value={formatAdminNumber(planCount)} detail="按周期计费的会员方案" />
        <AdminStat label="积分包" value={formatAdminNumber(pointsCount)} detail="一次性到账的积分商品" />
        <AdminStat label="促销活动" value={formatAdminNumber(promotions.length)} detail={`进行中 ${formatAdminNumber(promotions.filter((c) => c.enabled).length)}`} tone="warning" />
      </div>

      <AdminSectionCard
        title="商品与套餐"
        description="订阅套餐与积分包共用同一套商品模型。周期、价格、积分与订阅页展示权益都保存在这里。"
        action={canManage ? <ControlButton variant="primary" size="sm" onClick={() => setEditor('new')}><Plus className="size-3.5" />新增商品</ControlButton> : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <AdminInput aria-label="搜索商品" className="w-full sm:w-64" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索商品名称、说明或方案标识" />
          <AdminSelect aria-label="筛选商品类型" value={kind} onChange={(event) => setKind(event.target.value)} className="w-36"><option value="">全部类型</option><option value="plan">订阅套餐</option><option value="points">积分包</option></AdminSelect>
          <ControlButton variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>
        </div>

        {error && <div className="mt-3"><AdminError message={error} retry={load} /></div>}
        {message && <div className="mt-3"><AdminNotice tone="success">{message}</AdminNotice></div>}
        {groupIssues.length > 0 && (
          <div className="mt-3" data-testid="product-group-issues">
            <AdminNotice tone="warning">
              <span className="flex flex-col gap-1">
                <span className="font-medium">检测到 {groupIssues.length} 处同组展示配置问题（不会自动改价）：</span>
                {groupIssues.slice(0, 4).map((issue) => <span key={`${issue.groupId}-${issue.message}`}>· {issue.message}</span>)}
                {groupIssues.length > 4 && <span>· 其余 {groupIssues.length - 4} 处请在编辑对应商品时查看。</span>}
              </span>
            </AdminNotice>
          </div>
        )}

        <div className="mt-4">
          <AdminTable columns={['商品', '类型', '实付价格', '发放积分', '有效期', '排序', '上架', '操作']} minWidth={980} caption="商品列表">
            {visible.map((product) => (
              <AdminRow key={product.id}>
                <AdminCell className="max-w-[280px]"><p className="truncate font-medium">{product.name}</p><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{product.planId || product.id}</p>{product.description && <p className="mt-1 truncate text-[11px] text-muted-foreground">{product.description}</p>}</AdminCell>
                <AdminCell><StatusBadge tone={product.productKind === 'plan' ? 'accent' : 'muted'}>{product.productKind === 'plan' ? '订阅套餐' : '积分包'}</StatusBadge></AdminCell>
                <AdminCell>
                  <p className="font-medium">{formatAdminMoney(product.pricing?.saleUnitAmountCents ?? product.amountCents, product.currency)}</p>
                  {Boolean(product.pricing?.discountCents) && <p className="mt-1 text-[11px] text-muted-foreground line-through">{formatAdminMoney(product.pricing?.listUnitAmountCents, product.currency)}</p>}
                </AdminCell>
                <AdminCell className="text-xs">{formatAdminNumber(product.pointsAmount)}{product.dailyPoints ? <span className="mt-1 block text-[11px] text-muted-foreground">每日 {formatAdminNumber(product.dailyPoints)}</span> : null}</AdminCell>
                <AdminCell className="text-xs">{product.productKind === 'plan' ? `${product.periodDays} 天` : '一次性'}</AdminCell>
                <AdminCell className="text-xs">{product.sortOrder}</AdminCell>
                <AdminCell><StatusBadge tone={product.enabled ? 'success' : 'muted'}>{product.enabled ? '已上架' : '已下架'}</StatusBadge></AdminCell>
                <AdminCell>
                  <div className="flex flex-wrap gap-1.5">
                    {canManage && <ControlButton variant="secondary" size="sm" onClick={() => setEditor(product)}><Pencil className="size-3.5" />编辑</ControlButton>}
                    {canManage && <ControlButton variant={product.enabled ? 'danger' : 'secondary'} size="sm" disabled={busy === product.id} onClick={() => toggle(product)}>{product.enabled ? '下架' : '上架'}</ControlButton>}
                    {canManage && (
                      <ControlButton
                        variant="ghost" size="sm"
                        data-testid={`product-duplicate-${product.id}`}
                        disabled={busy === `copy:${product.id}`}
                        onClick={() => duplicate(product)}
                      >
                        <Copy className="size-3.5" />{busy === `copy:${product.id}` ? '复制中' : '复制'}
                      </ControlButton>
                    )}
                  </div>
                </AdminCell>
              </AdminRow>
            ))}
            {!visible.length && <TableMessageRow colSpan={8} loading={loading} error={error} empty="没有匹配的商品" />}
          </AdminTable>
        </div>
      </AdminSectionCard>

      <AdminSectionCard
        title="促销活动"
        description="按商品设置促销价与活动标签，订阅页会展示折后价格。"
        action={canManage ? <ControlButton variant="secondary" size="sm" onClick={() => setCampaign('new')}><BadgePercent className="size-3.5" />新增活动</ControlButton> : undefined}
      >
        {promotions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="text-muted-foreground"><tr>{['活动名称', '标签', '状态', '时间范围', '关联商品与折扣（自动计算）', '操作'].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {promotions.map((item) => (
                  <tr key={item.id} className="border-t border-border" data-testid={`promotion-row-${item.id}`}>
                    <td className="py-2.5 pr-3 font-medium">{item.name}</td>
                    <td className="py-2.5 pr-3">{item.label || '-'}</td>
                    <td className="py-2.5 pr-3"><StatusBadge tone={item.enabled ? 'success' : 'muted'}>{item.enabled ? '进行中' : '已停用'}</StatusBadge></td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{formatAdminDate(item.startsAt)} → {formatAdminDate(item.endsAt)}</td>
                    <td className="py-2.5 pr-3">
                      <span className="flex flex-col gap-0.5">
                        {campaignDiscountLabels(item).map((line) => <span key={line} className="text-muted-foreground">{line}</span>)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      {canManage && (
                        <span className="flex flex-wrap gap-1.5">
                          <ControlButton variant="secondary" size="sm" data-testid={`promotion-edit-${item.id}`} onClick={() => setCampaign(item)}><Pencil className="size-3.5" />编辑</ControlButton>
                          <ControlButton variant="danger" size="sm" data-testid={`promotion-delete-${item.id}`} disabled={busy === `campaign:${item.id}`} onClick={() => removeCampaign(item)}>删除</ControlButton>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <AdminEmpty title="暂无促销活动" description="创建活动后可以为指定商品设置促销价格；也可以在商品编辑器里直接填入活动价。" />}
      </AdminSectionCard>

      {editor && (
        <ProductEditor
          product={editor === 'new' ? undefined : editor}
          products={products}
          promotions={promotions}
          onClose={() => setEditor(null)}
          onSaved={(text) => { setMessage(text); setEditor(null); load() }}
          /**
           * 活动价写入后刷新活动列表。
           *
           * 只重载数据、**不替换 `editor` 里的商品对象**：替换会让 `initialDraft`
           * 重新生成，进而重置草稿、丢掉用户正在编辑的内容。
           * 编辑器自身已用后端返回结果更新价格快照（`applyActivePromotion`）。
           */
          onPromotionsChanged={load}
        />
      )}
      {campaign && <CampaignEditor campaign={campaign === 'new' ? undefined : campaign} products={products} onClose={() => setCampaign(null)} onSaved={(text) => { setMessage(text); setCampaign(null); load() }} />}
    </div>
  )
}

function Field({ label, hint, children, className, error, fieldId }: { label: string; hint?: string; children: ReactNode; className?: string; error?: string; fieldId?: string }) {
  return (
    <AdminField label={label} hint={error ?? hint} className={className}>
      {/* 字段级错误定位：错误信息渲染在对应字段下方，并标记 aria-invalid。 */}
      <span data-field={fieldId} className={error ? 'contents [&_input]:border-destructive [&_select]:border-destructive [&_textarea]:border-destructive' : 'contents'}>{children}</span>
    </AdminField>
  )
}

/**
 * 数字输入：保留用户原始输入，不静默取整。
 *
 * 早先实现直接在 onChange 里 `Math.round`，用户输入 `19.999` 或 `29.5`（天数）时
 * 会被悄悄改成整数，用户看不到自己输入了什么，也无法发现被改写。
 * 这里把原始字符串留在本地状态，只有确认是合法整数/金额时才写回草稿，
 * 非法输入会显示明确提示。
 */
function NumberField({ label, value, onChange, integer = true, hint, error, fieldId, ariaLabel, testId, amount = false }: {
  label: string
  value: number
  onChange: (value: number) => void
  integer?: boolean
  hint?: string
  error?: string
  fieldId?: string
  ariaLabel?: string
  testId?: string
  /** 以「元」展示（内部按分存储）：显示为 299 而不是 29900。 */
  amount?: boolean
}) {
  const toDisplay = (input: number) => (amount ? (Number.isFinite(input) ? String(input / 100) : '') : String(input))
  const [raw, setRaw] = useState(() => toDisplay(value))
  const [invalid, setInvalid] = useState('')
  // 外部值变化（例如一键还原、商品切换）时同步显示；不覆盖用户正在输入的等价文本。
  const lastExternalRef = useRef(value)
  useEffect(() => {
    if (lastExternalRef.current === value) return
    lastExternalRef.current = value
    setRaw(toDisplay(value))
    setInvalid('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function handleChange(next: string) {
    setRaw(next)
    if (!next.trim()) { setInvalid('不能为空'); return }
    if (amount) {
      // 金额：最多两位小数，按分写入；不静默取整。
      if (!/^\d+(\.\d{0,2})?$/.test(next.trim())) { setInvalid('金额必须是最多两位小数的数字'); return }
      const cents = Math.round(Number(next.trim()) * 100)
      if (!Number.isSafeInteger(cents)) { setInvalid('金额超出安全范围'); return }
      setInvalid('')
      lastExternalRef.current = cents
      onChange(cents)
      return
    }
    if (integer) {
      if (!/^-?\d+$/.test(next.trim())) { setInvalid('必须是整数（不支持小数）'); return }
      const parsed = Number(next.trim())
      if (!Number.isSafeInteger(parsed)) { setInvalid('数值超出安全范围'); return }
      setInvalid('')
      lastExternalRef.current = parsed
      onChange(parsed)
    }
  }

  return (
    <Field label={label} error={error ?? (invalid || undefined)} fieldId={fieldId} hint={hint}>
      <AdminInput
        aria-label={ariaLabel ?? label}
        data-testid={testId}
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(event) => handleChange(event.target.value)}
        aria-invalid={Boolean(invalid) || undefined}
      />
    </Field>
  )
}

/**
 * 商品编辑器（含实时预览）。
 *
 * 关键设计：
 * - 全部字段进入受控草稿（`ProductDraft`），预览与保存共用 `draftToPayload`，
 *   因此「预览所见 = 保存所得」；
 * - 预览复用真实 `MembershipPurchaseView` / `PlanCard` / `toMembershipPlans`；
 * - 预览本身零写入：不保存、不上架、不创建订单；切换周期/受众/档位都不写库；
 * - 有未保存修改时关闭需确认，并提供一键还原；
 * - 保存期间按钮禁用，避免重复提交。
 */
function ProductEditor({ product, products, promotions, onClose, onSaved, onPromotionsChanged }: {
  product?: BillingProduct
  products: BillingProduct[]
  promotions: PromotionCampaign[]
  onClose: () => void
  onSaved: (message: string) => void
  onPromotionsChanged: () => void
}) {
  const initialDraft = useMemo(() => (product ? productToDraft(product) : emptyDraft(products.length)), [product, products.length])
  const [draft, setDraft] = useState<ProductDraft>(initialDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  /** 保存前差异确认：列出真正变化的字段，并标出敏感变更。 */
  const [pendingDiff, setPendingDiff] = useState<DraftDiffEntry[] | null>(null)
  /** 多人编辑冲突：后端返回 409 时保存被拒，提示重新加载。 */
  const [conflict, setConflict] = useState('')

  // 商品切换（例如保存后重新打开）时重置草稿。
  useEffect(() => { setDraft(initialDraft); setError('') }, [initialDraft])

  /**
   * `serverPricing` 是**后端下发的价格快照**（含活动价），不是用户编辑内容。
   *
   * 商品编辑器里保存/清除活动价后要立刻更新这份快照（预览与折扣来自它），
   * 若把它算进 `dirty`，刚保存完活动价就会显示「有未保存的修改」并弹出放弃确认，
   * 而实际上那次修改已经写库了。因此比较时排除该字段。
   */
  const dirtySignature = (value: ProductDraft) => JSON.stringify({ ...value, serverPricing: undefined })
  const dirty = useMemo(() => dirtySignature(draft) !== dirtySignature(initialDraft), [draft, initialDraft])
  const issues = useMemo(() => validateDraft(draft, { products }), [draft, products])
  const errors = issues.filter((issue) => issue.level === 'error')
  const warnings = issues.filter((issue) => issue.level === 'warning')
  const errorFor = (field: string) => errors.find((issue) => issue.field === field)?.message

  /**
   * 折扣与权益行数的可推导结果（供编辑区显示）。
   *
   * 折扣按后端 `formatDiscount` 的算法从「日常价 / 活动价」推导，
   * 活动价按后端 `selectCurrentPromotion` 规则判断当前是否生效。
   */
  const activePromotion = useMemo(() => resolvePromotionForAmount(
    draft.serverPricing?.promotion,
    draft.amountCents,
    { currencyChanged: Boolean(product && product.currency !== draft.currency) },
  ), [draft.amountCents, draft.currency, draft.serverPricing?.promotion, product])
  const computedDiscount = activePromotion ? discountLabelOf(draft.amountCents, Number(activePromotion.unitAmountCents) || 0) : null

  /**
   * 活动价编辑（商品维度）。
   *
   * 此前商品编辑器只**显示**活动价，运营要改某个商品的活动价，必须切到
   * 「促销活动」区块 → 找到包含该商品的活动 → 在活动里找到该商品那一行。
   * 单个商品没有自己的活动价入口。这里补上，并复用后端同一套校验与写入接口。
   */
  const ownerPromotion = useMemo(
    () => (product ? findPromotionForProduct(promotions, product.id) : undefined),
    [product, promotions],
  )
  const savedPromotionAmount = product ? promotionAmountFor(ownerPromotion, product.id) : null
  const [promoInput, setPromoInput] = useState(() => (savedPromotionAmount === null ? '' : String(savedPromotionAmount / 100)))
  const [promoBusy, setPromoBusy] = useState(false)
  const [promoError, setPromoError] = useState('')
  const [promoNotice, setPromoNotice] = useState('')

  /**
   * 输入框跟随后端权威值。
   *
   * 活动价保存成功后父组件会重载活动列表，`savedPromotionAmount` 随之变化；
   * 这里只在「商品或价格真的变了」时同步输入框，且**不清除成功提示**
   * ——否则「活动价已更新」会刚显示就被重载清掉，用户看不到结果。
   */
  const lastPromoSyncRef = useRef('')
  useEffect(() => {
    const next = savedPromotionAmount === null ? '' : String(savedPromotionAmount / 100)
    const key = `${product?.id ?? ''}:${next}`
    if (lastPromoSyncRef.current === key) return
    lastPromoSyncRef.current = key
    setPromoInput(next)
  }, [product?.id, savedPromotionAmount])

  // 切换商品时清空上一次的提示与错误。
  useEffect(() => { setPromoError(''); setPromoNotice('') }, [product?.id])

  /** 输入即校验：只做与后端一致的规则判断，不静默取整或改写用户输入。 */
  const promoValidation = useMemo(() => {
    const text = promoInput.trim()
    if (!text) return null
    if (!/^\d+(\.\d{0,2})?$/.test(text)) return '活动价必须是最多两位小数的数字'
    return validatePromotionAmount(Math.round(Number(text) * 100), draft.amountCents)
  }, [promoInput, draft.amountCents])

  const benefitRows = useMemo(() => {
    const configured = linesToList(draft.display.benefits)
    const dailyRow = draft.productKind === 'plan' && draft.dailyPoints > 0 ? 1 : 0
    const base = (configured.length ? configured.length : (draft.description ? 1 : 0)) + dailyRow
    return base + linesToList(draft.display.promotions).length + linesToList(draft.display.exclusiveBenefits).length + linesToList(draft.display.extraBenefits).length
  }, [draft.description, draft.display, draft.dailyPoints, draft.productKind])

  const patch = (values: Partial<ProductDraft>) => setDraft((current) => ({ ...current, ...values }))
  const patchDisplay = (values: Partial<ProductDraft['display']>) => setDraft((current) => ({ ...current, display: { ...current.display, ...values } }))

  /** 关闭编辑器：有未保存修改时先确认，避免误丢草稿。 */
  function requestClose() {
    if (busy) return
    if (dirty) { setConfirmDiscard(true); return }
    onClose()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    setConflict('')
    if (errors.length) {
      setError(`请先修正 ${errors.length} 处校验错误：${errors[0].message}`)
      return
    }
    /**
     * 保存前差异确认。
     *
     * 字段多、且包含价格与上下架这类敏感项，直接保存很容易误改。
     * 这里先算差异并要求确认；**没有实际变化时直接提示，不发请求**
     * （避免产生一次无意义的写入与审计记录）。
     */
    const changes = diffProductDraft(initialDraft, draft)
    if (!changes.length) {
      setError('没有检测到任何修改，未提交保存。')
      return
    }
    setPendingDiff(changes)
  }

  /**
   * 真正写入。
   *
   * 编辑已有商品时带 `expectedUpdatedAt`：若期间有别人改过同一商品，
   * 后端返回 409，这里如实提示并**不覆盖**对方的修改。
   */
  async function persist() {
    setBusy(true)
    setError('')
    setConflict('')
    setPendingDiff(null)
    try {
      // 保存与预览使用同一份转换，避免两条路径产生不同字段。
      const payload = draftToPayload(draft)
      if (product) await updateBillingProduct(product.id, payload, product.updatedAt)
      else await createBillingProduct(payload)
      onSaved(product ? '商品已保存' : '商品已创建')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '保存失败，草稿已保留'
      // 409 是「别人也在改」：单独提示，引导重新加载而不是重试覆盖。
      if (reason instanceof StudioApiError && reason.status === 409) setConflict(message)
      else setError(message)    } finally {
      setBusy(false)
    }
  }

  /**
   * 写入活动价：优先复用该商品已有的活动，没有活动时新建一个。
   *
   * 与后端 `savePromotionCampaign` 共用同一套规则；后端拒绝时把原始错误显示在字段下方。
   */
  async function savePromotionAmount() {
    if (!product || promoBusy) return
    setPromoError(''); setPromoNotice('')
    const text = promoInput.trim()
    if (!/^\d+(\.\d{0,2})?$/.test(text)) { setPromoError('活动价必须是最多两位小数的数字'); return }
    const cents = Math.round(Number(text) * 100)
    const invalid = validatePromotionAmount(cents, draft.amountCents)
    if (invalid) { setPromoError(invalid); return }
    setPromoBusy(true)
    try {
      const built = buildPromotionPayload({
        promotion: ownerPromotion,
        productId: product.id,
        productName: product.name,
        promotionalAmountCents: cents,
      })
      const saved = built.id
        ? await updatePromotion(built.id, built.body)
        : await savePromotion(built.body)
      applyActivePromotion(saved, product.id)
      setPromoNotice(built.id ? `活动价已更新为 ${formatAdminMoney(cents, draft.currency)}（活动「${saved?.name ?? ownerPromotion?.name ?? ''}」）` : `已创建活动并设置活动价 ${formatAdminMoney(cents, draft.currency)}`)
      onPromotionsChanged()
    } catch (reason) {
      setPromoError(reason instanceof Error ? reason.message : '活动价保存失败')
    } finally {
      setPromoBusy(false)
    }
  }

  /**
   * 清除活动价：从活动里移除该商品；活动因此变空时直接删除活动。
   *
   * 直接删整个活动会让界面「刚点清除，活动就没了」却没有任何提示，
   * 因此这里明确区分两种结果并如实告知。
   */
  async function clearPromotionAmount() {
    if (!product || promoBusy || !ownerPromotion) return
    setPromoError(''); setPromoNotice('')
    setPromoBusy(true)
    try {
      const removal = buildPromotionRemoval({ promotion: ownerPromotion, productId: product.id })
      if (removal.remove) {
        await deletePromotion(ownerPromotion.id)
        applyActivePromotion(undefined, product.id)
        setPromoNotice(`活动价已清除；活动「${ownerPromotion.name}」只包含该商品，已一并删除`)
      } else {
        const saved = await updatePromotion(removal.id, removal.body)
        applyActivePromotion(saved, product.id)
        setPromoNotice(`活动价已清除；活动「${saved?.name ?? ownerPromotion.name}」仍保留其余 ${removal.body.products.length} 个商品`)
      }
      onPromotionsChanged()
    } catch (reason) {
      setPromoError(reason instanceof Error ? reason.message : '清除活动价失败')
    } finally {
      setPromoBusy(false)
    }
  }

  /**
   * 用后端返回的权威价格快照更新草稿。
   *
   * 后端返回体里没有商品级 `pricing`（`resolveBillingProductPrices` 才计算它），
   * 因此这里用返回的活动与日常价按后端规则重算
   * （`resolvePreviewPricing` 与后端 `resolveProductPrice` 同源），
   * 而不是把本地输入当作结果——否则后端修正过的值会与界面不一致。
   */
  function applyActivePromotion(campaign: PromotionCampaign | undefined, productId: string) {
    const amount = campaign ? promotionAmountFor(campaign, productId) : null
    setDraft((current) => ({
      ...current,
      serverPricing: resolvePreviewPricing(
        current.amountCents,
        campaign && amount !== null
          ? { id: campaign.id, label: campaign.label, unitAmountCents: amount, startsAt: campaign.startsAt, endsAt: campaign.endsAt }
          : undefined,
      ),
    }))
  }

  return (
    <AdminDrawer
      open
      onClose={requestClose}
      width="sm:max-w-[1180px]"
      title={product ? `编辑商品 ${product.name}` : '新增商品'}
      description={dirty ? '有未保存的修改' : '金额以元为单位填写，保存时转换为分。'}
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        {/* 桌面：表单与预览并排；手机：单列，预览在表单下方，操作仍易触达。 */}
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          <div className="flex min-w-0 flex-col gap-5">
            <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
              <legend className="sr-only">商品基础信息</legend>
              <Field label="商品名称" error={errorFor('name')} fieldId="name"><AdminInput aria-label="商品名称" value={draft.name} onChange={(event) => patch({ name: event.target.value })} maxLength={80} /></Field>
              <Field label="商品类型" fieldId="productKind"><AdminSelect aria-label="商品类型" value={draft.productKind} onChange={(event) => patch({ productKind: event.target.value === 'plan' ? 'plan' : 'points' })}><option value="points">积分包</option><option value="plan">订阅套餐</option></AdminSelect></Field>
              <NumberField
                label="日常价（元）" fieldId="amountCents" amount testId="product-amount"
                hint="精确到分，例如 19.90"
                error={errorFor('amountCents')}
                value={draft.amountCents}
                onChange={(cents) => patch({ amountCents: cents })}
              />
              <Field label="币种" fieldId="currency"><AdminSelect aria-label="币种" value={draft.currency} onChange={(event) => patch({ currency: event.target.value })}><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option></AdminSelect></Field>
              <NumberField
                label="一次发放积分" fieldId="pointsAmount" testId="product-points"
                error={errorFor('pointsAmount')}
                value={draft.pointsAmount}
                onChange={(value) => patch({ pointsAmount: value })}
              />
              <NumberField
                label="显示顺序" fieldId="sortOrder" testId="product-sort"
                hint="数值越小越靠前"
                error={errorFor('sortOrder')}
                value={draft.sortOrder}
                onChange={(value) => patch({ sortOrder: value })}
              />
              {draft.productKind === 'plan' && <>
                <Field label="关联权益方案 ID" error={errorFor('planId')} fieldId="planId" hint="需要后台已存在同名权益方案。"><AdminInput aria-label="关联权益方案 ID" value={draft.planId} onChange={(event) => patch({ planId: event.target.value })} /></Field>
                <NumberField
                  label="有效期（天）" fieldId="periodDays" testId="product-period"
                  error={errorFor('periodDays')}
                  value={draft.periodDays}
                  onChange={(value) => patch({ periodDays: value })}
                />
                <NumberField
                  label="每日积分" fieldId="dailyPoints" testId="product-daily"
                  error={errorFor('dailyPoints')}
                  value={draft.dailyPoints}
                  onChange={(value) => patch({ dailyPoints: value })}
                />
              </>}
              <Field label="商品说明" className="sm:col-span-2"><AdminTextarea aria-label="商品说明" maxLength={500} rows={2} value={draft.description} onChange={(event) => patch({ description: event.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />上架商品</label>
            </fieldset>

            <fieldset disabled={busy} className="grid min-w-0 gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <legend className="text-sm font-semibold">订阅页展示</legend>
              <Field label="套餐显示名称" fieldId="displayName"><AdminInput aria-label="套餐显示名称" value={draft.display.name} onChange={(event) => patchDisplay({ name: event.target.value })} /></Field>
              <Field label="会员类型" fieldId="audience"><AdminSelect aria-label="会员类型" value={draft.display.audience} onChange={(event) => patchDisplay({ audience: event.target.value === 'team' ? 'team' : 'creator' })}><option value="creator">创作会员</option><option value="team">团队版会员</option></AdminSelect></Field>
              <Field label="套餐分组标识" fieldId="groupId" hint="同套餐的月付、季付、年付使用相同标识。"><AdminInput aria-label="套餐分组标识" value={draft.display.groupId} onChange={(event) => patchDisplay({ groupId: event.target.value })} /></Field>
              <Field label="配色" fieldId="tone" hint="留空＝自动（按分组顺序分配，与用户页一致）">
                <AdminSelect aria-label="配色" value={draft.display.tone} onChange={(event) => patchDisplay({ tone: event.target.value })}>
                  {/* 空值表示「未设置 → 自动配色」，不能被强制替换成 standard。 */}
                  <option value="">自动（按分组顺序）</option>
                  {tones.map((tone, index) => <option key={tone} value={tone}>{['深灰', '石墨', '银灰', '青色', '橙色'][index] || tone}</option>)}
                </AdminSelect>
              </Field>
              <Field label="积分档位标识" error={errorFor('tierId')} fieldId="tierId"><AdminInput aria-label="积分档位标识" value={draft.display.tierId} onChange={(event) => patchDisplay({ tierId: event.target.value })} /></Field>
              <Field label="档位名称" fieldId="tierLabel" hint="建议 2–12 个字；过长会在卡片上换行或省略显示">
                <AdminInput aria-label="档位名称" value={draft.display.tierLabel} maxLength={24} onChange={(event) => patchDisplay({ tierLabel: event.target.value })} />
              </Field>
              <Field label="活动角标" fieldId="badge" hint="展示在卡片标题旁；留空则不显示"><AdminInput aria-label="活动角标" value={draft.display.badge} onChange={(event) => patchDisplay({ badge: event.target.value })} /></Field>
              <Field label="生成量说明" fieldId="generationSummary"><AdminInput aria-label="生成量说明" value={draft.display.generationSummary} onChange={(event) => patchDisplay({ generationSummary: event.target.value })} /></Field>
              {([['benefits', '基础权益'], ['promotions', '限时活动'], ['exclusiveBenefits', '独家功能'], ['extraBenefits', '更多权益']] as const).map(([name, label]) => (
                <Field key={name} label={`${label}（每行一项）`} fieldId={name}>
                  <AdminTextarea aria-label={label} rows={3} value={draft.display[name]} onChange={(event) => patchDisplay({ [name]: event.target.value } as Partial<ProductDraft['display']>)} />
                </Field>
              ))}
              {/**
                * 价格与折扣的可推导结果 + **活动价编辑入口**。
                *
                * 折扣是「日常价 / 活动价」的确定计算结果，不需要运营手填。
                * 活动价此前只能在「促销活动」区块按活动整体编辑，
                * 商品编辑器里只显示不可改，运营在编辑单个商品时无法设置活动价。
                */}
              <div className="rounded-lg border border-border bg-muted/40 p-3 sm:col-span-2" data-testid="product-price-summary">
                <p className="text-xs font-medium text-foreground">价格与折扣（自动计算）</p>
                <div className="mt-2 grid gap-1.5 text-[11px] leading-5 text-muted-foreground">
                  <span>日常价：{formatAdminMoney(draft.amountCents, draft.currency)}</span>
                  <span data-testid="product-active-price">
                    活动价：{activePromotion
                      ? `${formatAdminMoney(Number(activePromotion.unitAmountCents) || 0, draft.currency)}（${activePromotion.label || '活动'}，${activePromotion.startsAt ? new Date(activePromotion.startsAt).toLocaleString('zh-CN', { hour12: false }) : '时间未配置'} 起）`
                      : '当前无生效活动（或活动价不低于日常价）'}
                  </span>
                  <span data-testid="product-discount">
                    折扣：{computedDiscount
                      ? `${computedDiscount}（由日常价与活动价推导，卡片会自动展示）`
                      : '无折扣（活动价必须低于日常价才会显示折扣）'}
                  </span>
                  <span>权益行数：{benefitRows} 行{benefitRows > 6 ? '（超过 6 行，卡片会自动折叠并显示「查看更多权益」）' : '（不超过 6 行，不折叠）'}</span>
                </div>

                {/**
                  * 活动价编辑入口：此前商品编辑器只能看不能改，必须绕到「促销活动」区块。
                  *
                  * 仅对**已存在的商品**提供：活动价挂在「活动 × 商品」上，需要真实商品 ID。
                  * 新增商品时先保存，再回来设置活动价。
                  */}
                {product && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3" data-testid="product-promotion-editor">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-foreground">
                        活动价（元）{ownerPromotion ? `· 所属活动：${ownerPromotion.name}${ownerPromotion.enabled ? '' : '（已停用）'}` : '· 保存后将新建一个 30 天活动'}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <AdminInput
                          aria-label="活动价（元）"
                          data-testid="product-promo-amount"
                          className="w-32"
                          inputMode="decimal"
                          placeholder={savedPromotionAmount === null ? '未设置' : String(savedPromotionAmount / 100)}
                          value={promoInput}
                          aria-invalid={Boolean(promoValidation) || undefined}
                          onChange={(event) => { setPromoInput(event.target.value); setPromoNotice('') }}
                        />
                        <ControlButton
                          type="button"
                          variant="secondary"
                          size="sm"
                          data-testid="product-promo-save"
                          disabled={promoBusy || !promoInput.trim() || Boolean(promoValidation)}
                          onClick={() => void savePromotionAmount()}
                        >
                          {promoBusy ? '保存中…' : savedPromotionAmount === null ? '设置活动价' : '更新活动价'}
                        </ControlButton>
                        {savedPromotionAmount !== null && (
                          <ControlButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            data-testid="product-promo-clear"
                            disabled={promoBusy}
                            onClick={() => void clearPromotionAmount()}
                          >
                            清除活动价
                          </ControlButton>
                        )}
                      </span>
                    </label>
                    {/* 输入即校验（与后端同一规则），避免提交后才报错。 */}
                    {promoValidation && <p className="text-[11px] text-destructive" role="alert" data-testid="product-promo-error">{promoValidation}</p>}
                    {promoNotice && <p className="text-[11px] text-studio-accent" role="status" data-testid="product-promo-notice">{promoNotice}</p>}
                    {promoError && <p className="text-[11px] text-destructive" role="alert" data-testid="product-promo-error">{promoError}</p>}
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      活动价必须大于 0 且低于日常价。保存后由后端计算折扣，此处的价格与折扣、右侧预览和用户套餐页会同时生效；
                      活动名称、标签与时间范围可在下方「促销活动」区块统一管理。
                    </p>
                  </div>
                )}
              </div>
            </fieldset>
          </div>

          {showPreview && (
            <div className="min-w-0 xl:sticky xl:top-0 xl:self-start">
              <ProductPreviewPanel draft={draft} products={products} />
            </div>
          )}
        </div>

        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
        {conflict && (
          <div data-testid="product-conflict">
            <AdminNotice tone="danger">
              <span className="flex flex-col gap-1">
                <span className="font-medium">保存被拒绝：该商品已被其他人修改</span>
                <span className="text-[11px] leading-5">{conflict}</span>
                <span className="text-[11px] leading-5">
                  为避免覆盖对方的修改，本次保存**没有写入**。请先记录你的改动，然后关闭编辑器重新打开以加载最新版本。
                </span>
              </span>
            </AdminNotice>
          </div>
        )}
        {warnings.length > 0 && (
          <AdminNotice tone="warning">
            <span className="flex flex-col gap-1">{warnings.map((issue) => <span key={`${issue.field}-${issue.message}`}>· {issue.message}</span>)}</span>
          </AdminNotice>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <ControlButton type="button" variant="ghost" size="sm" onClick={() => setShowPreview((value) => !value)}>{showPreview ? '隐藏预览' : '显示预览'}</ControlButton>
            {/**
              * 一键还原只回滚**商品字段**，保留当前价格快照。
              *
              * 活动价是独立资源、点一下就已经写库；把它一起回滚成打开抽屉时的旧快照，
              * 会出现「刚保存的活动价被界面抹掉、但数据库里还在」的假象。
              */}
            <ControlButton type="button" variant="ghost" size="sm" disabled={!dirty || busy} onClick={() => { setDraft((current) => ({ ...initialDraft, serverPricing: current.serverPricing })); setError('') }}>
              <RotateCcw className="size-3.5" />一键还原
            </ControlButton>
            {dirty && <span className="text-[11px] text-studio-warn">有未保存的修改</span>}
          </div>
          <div className="flex items-center gap-2">
            <ControlButton type="button" variant="secondary" onClick={requestClose} disabled={busy}>取消</ControlButton>
            <ControlButton type="submit" variant="primary" disabled={busy || errors.length > 0} data-testid="product-save">
              <Save className="size-3.5" />{busy ? '保存中' : errors.length ? `修正 ${errors.length} 处错误` : '保存商品'}
            </ControlButton>
          </div>
        </div>
      </form>

      <Modal
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="放弃未保存的修改？"
        description="预览不会写入数据；关闭后本次编辑的改动会丢失。"
        footer={(
          <>
            <ControlButton variant="ghost" onClick={() => setConfirmDiscard(false)}>继续编辑</ControlButton>
            <ControlButton variant="danger" onClick={() => { setConfirmDiscard(false); onClose() }}>放弃修改</ControlButton>
          </>
        )}
      >
        <p className="text-xs leading-5 text-muted-foreground">商品「{draft.name || '未命名商品'}」有未保存的修改。</p>
      </Modal>

      {/**
        * 保存前差异确认。
        *
        * 字段多且含价格、上下架、权益这类敏感项，直接保存容易误改。
        * 这里逐条列出「真正变化」的字段，并把敏感变更单独标出，
        * 让运营在写入前有机会核对；确认后才真正提交。
        */}
      <Modal
        open={pendingDiff !== null}
        onClose={() => setPendingDiff(null)}
        title="确认保存这些修改？"
        description={product ? `将更新商品「${product.name}」` : '将创建新商品'}
        footer={(
          <>
            <ControlButton variant="ghost" onClick={() => setPendingDiff(null)} disabled={busy}>返回检查</ControlButton>
            <ControlButton variant="primary" onClick={() => void persist()} disabled={busy} data-testid="product-diff-confirm">
              {busy ? '保存中' : `确认保存（${pendingDiff?.length ?? 0} 处修改）`}
            </ControlButton>
          </>
        )}
      >
        <div className="flex flex-col gap-2" data-testid="product-diff">
          {hasSensitiveDiff(pendingDiff ?? []) && (
            <AdminNotice tone="warning">
              其中包含价格、上下架、积分或权益的变更（已用「敏感」标出），会直接影响收入或用户可见内容，请重点核对。
            </AdminNotice>
          )}
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>{['字段', '修改前', '修改后'].map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}</tr>
              </thead>
              <tbody>
                {(pendingDiff ?? []).map((entry) => (
                  <tr key={entry.field} className="border-t border-border" data-testid={`diff-${entry.field}`} data-sensitive={entry.sensitive ? 'true' : 'false'}>
                    <td className="py-2 pr-3 align-top">
                      <span className="font-medium text-foreground">{entry.label}</span>
                      {entry.sensitive && <span className="ml-1 rounded bg-studio-warn/15 px-1 py-0.5 text-[10px] text-studio-warn">敏感</span>}
                    </td>
                    <td className="max-w-[180px] break-words py-2 pr-3 align-top text-muted-foreground line-through">{entry.before}</td>
                    <td className="max-w-[180px] break-words py-2 pr-3 align-top font-medium text-foreground">{entry.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">
            共 {pendingDiff?.length ?? 0} 处修改。保存时若该商品已被其他人改动，系统会拒绝写入并提示你重新加载，不会覆盖对方的修改。
          </p>
        </div>
      </Modal>
    </AdminDrawer>
  )
}

function CampaignEditor({ campaign, products, onClose, onSaved }: { campaign?: PromotionCampaign; products: BillingProduct[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [selected, setSelected] = useState<Array<{ productId: string; promotionalAmountCents: number }>>(campaign?.products ?? [])
  /**
   * 活动价以「元」文本保存，而不是在 onChange 里 `Math.round(x * 100)`。
   *
   * 早先实现每次按键都取整写回分，用户输入 `239.2` 的过程中会看到
   * 值被改写，输入 `239.25` 更是被静默截断成 `239.25 → 23925`（看似正常）
   * 但 `239.249` 这类输入会被悄悄改成另一个数。这里保留原始文本，
   * 提交时统一校验，非法输入直接报错而不是改数。
   */
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const entry of campaign?.products ?? []) initial[entry.productId] = String(entry.promotionalAmountCents / 100)
    return initial
  })
  const [enabled, setEnabled] = useState(campaign?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const productOf = (productId: string) => products.find((product) => product.id === productId)

  /** 每行的校验结果（与后端 `validatePromotionPrices` 同一规则）。 */
  const rowIssues = useMemo(() => {
    const issues: Record<string, string> = {}
    for (const entry of selected) {
      const product = productOf(entry.productId)
      if (!product) { issues[entry.productId] = '商品不存在'; continue }
      const text = (amounts[entry.productId] ?? '').trim()
      if (!text) { issues[entry.productId] = '请填写活动价'; continue }
      if (!/^\d+(\.\d{0,2})?$/.test(text)) { issues[entry.productId] = '必须是最多两位小数的数字'; continue }
      const invalid = validatePromotionAmount(Math.round(Number(text) * 100), product.amountCents)
      if (invalid) issues[entry.productId] = invalid
    }
    return issues
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amounts, products, selected])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      if (!selected.length) throw new Error('请至少选择一个参与活动的商品')
      if (Object.keys(rowIssues).length) throw new Error(`有 ${Object.keys(rowIssues).length} 个商品的活动价不合法：${Object.values(rowIssues)[0]}`)
      const body = {
        id: campaign?.id,
        name: String(data.get('name') || '').trim(),
        label: String(data.get('label') || '').trim(),
        enabled,
        startsAt: toIso(String(data.get('startsAt') || '')),
        endsAt: toIso(String(data.get('endsAt') || '')),
        products: selected.map((entry) => ({
          productId: entry.productId,
          promotionalAmountCents: Math.round(Number((amounts[entry.productId] ?? '').trim()) * 100),
        })),
      }
      if (campaign) await updatePromotion(campaign.id, body)
      else await savePromotion(body)
      onSaved(campaign ? '促销活动已保存' : '促销活动已创建')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminDrawer open onClose={onClose} title={campaign ? `编辑活动 ${campaign.name}` : '新增促销活动'} description="活动价格以元为单位填写，保存时转换为分。">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <Field label="活动名称"><AdminInput name="name" required maxLength={80} defaultValue={campaign?.name} /></Field>
          <Field label="活动标签" hint="展示在卡片上的促销文案，例如「限时 8 折」"><AdminInput name="label" maxLength={40} defaultValue={campaign?.label} placeholder="例如：限时 8 折" /></Field>
          <Field label="开始时间"><AdminInput name="startsAt" type="datetime-local" defaultValue={toLocalInput(campaign?.startsAt)} /></Field>
          <Field label="结束时间" hint="同一商品不能存在时间重叠的两个启用活动"><AdminInput name="endsAt" type="datetime-local" defaultValue={toLocalInput(campaign?.endsAt)} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用该活动</label>
        </fieldset>

        <AdminSectionCard title="参与商品与活动价" className="p-4">
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {products.map((product) => {
              const entry = selected.find((item) => item.productId === product.id)
              const text = amounts[product.id] ?? ''
              const cents = Math.round(Number(text) * 100)
              const discount = entry && !rowIssues[product.id] && text ? discountLabelOf(product.amountCents, cents) : null
              return (
                <div key={product.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-2 last:border-b-0">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={Boolean(entry)}
                      data-testid={`campaign-product-${product.id}`}
                      onChange={() => setSelected((current) => entry
                        ? current.filter((item) => item.productId !== product.id)
                        : [...current, { productId: product.id, promotionalAmountCents: product.amountCents }])}
                    />
                    <span className="min-w-0 truncate">{product.name}</span>
                    <span className="shrink-0 text-muted-foreground">日常价 {formatAdminMoney(product.amountCents, product.currency)}</span>
                  </label>
                  <AdminInput
                    aria-label={`${product.name} 活动价（元）`}
                    data-testid={`campaign-amount-${product.id}`}
                    className="w-32" inputMode="decimal"
                    disabled={!entry}
                    value={text}
                    aria-invalid={Boolean(rowIssues[product.id]) || undefined}
                    onChange={(event) => setAmounts((current) => ({ ...current, [product.id]: event.target.value }))}
                  />
                  {/* 折扣由「日常价 / 活动价」推导，不手填；这里即时反馈，保存结果与之一致。 */}
                  <span className="w-24 shrink-0 text-[11px] text-muted-foreground" data-testid={`campaign-discount-${product.id}`}>
                    {entry ? (rowIssues[product.id] ? rowIssues[product.id] : discount ? `→ ${discount}` : '无折扣') : ''}
                  </span>
                </div>
              )
            })}
            {!products.length && <p className="text-xs text-muted-foreground">还没有可参与活动的商品。</p>}
          </div>
        </AdminSectionCard>

        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <ControlButton variant="secondary" onClick={onClose} disabled={busy}>取消</ControlButton>
          <ControlButton type="submit" variant="primary" disabled={busy || Object.keys(rowIssues).length > 0} data-testid="campaign-save">{busy ? '保存中' : '保存活动'}</ControlButton>
        </div>
      </form>
    </AdminDrawer>
  )
}

function toIso(value: string) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function toLocalInput(value?: string) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/* --------------------------------- 订单 --------------------------------- */

const orderStatuses = ['pending', 'paid', 'closed', 'canceled', 'refunding', 'refunded'] as const

export function AdminOrdersPanel() {
  const session = useAdminSession()
  const { reloadKey } = useAdminReload()
  const canRead = session.can('billing.read')
  const canManage = session.can('billing.manage')

  const [orders, setOrders] = useState<Paged<BillingOrder>>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<BillingOrder | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const confirm = useConfirm()

  const [tab, setTab] = useState<'orders' | 'coupons' | 'referrals'>('orders')

  const load = useCallback(() => {
    setLoading(true); setError('')
    Promise.all([listBillingOrders({ page, pageSize: 20, status, keyword: query }), getFinanceSummary()])
      .then(([orderPage, finance]) => { setOrders(orderPage); setSummary(finance) })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '订单加载失败'))
      .finally(() => setLoading(false))
  }, [page, status, query, reloadKey])

  useEffect(() => { void load() }, [load])

  const refund = useCallback((order: BillingOrder) => {
    confirm.confirm({
      title: `为订单 ${order.orderNo} 退款？`,
      description: '退款会按支付渠道执行，并撤回已发放的积分与套餐权益。该操作不可撤销。',
      confirmLabel: '确认退款',
      tone: 'danger',
      onConfirm: async () => {
        setActing(order.id)
        try { await refundBillingOrder(order.id, '管理员后台退款'); setMessage('退款已提交'); load() }
        finally { setActing(null) }
      },
    })
  }, [confirm, load])

  const close = useCallback((order: BillingOrder) => {
    confirm.confirm({
      title: `关闭订单 ${order.orderNo}？`,
      description: '关闭后用户无法继续支付该订单，已支付订单不会被关闭。',
      confirmLabel: '确认关闭',
      tone: 'danger',
      onConfirm: async () => {
        setActing(order.id)
        try { await closeBillingOrder(order.id, '管理员后台关闭'); setMessage('订单已关闭'); load() }
        finally { setActing(null) }
      },
    })
  }, [confirm, load])

  const complete = useCallback((order: BillingOrder) => {
    confirm.confirm({
      title: `将订单 ${order.orderNo} 标记为已支付？`,
      description: '用于人工确认线下收款。标记后会立即发放对应积分或套餐权益。',
      confirmLabel: '确认已支付',
      tone: 'default',
      onConfirm: async () => {
        setActing(order.id)
        try { await completeBillingOrder(order.id, '管理员人工确认收款'); setMessage('订单已标记为已支付'); load() }
        finally { setActing(null) }
      },
    })
  }, [confirm, load])

  if (!canRead) return <AdminError message="当前管理员没有查看订单的职责权限。" />

  const finance = summary

  return (
    <div className="flex flex-col gap-5">
      {confirm.dialog}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStat label="订单总数" value={formatAdminNumber(finance?.orders.total)} detail={`待支付 ${formatAdminNumber(finance?.orders.pending)} · 已支付 ${formatAdminNumber(finance?.orders.paid)}`} />
        <AdminStat label="已支付金额" value={formatAdminMoney(finance?.orders.paidAmountCents)} detail={`毛收入 ${formatAdminMoney(finance?.orders.grossAmountCents)}`} tone="success" />
        <AdminStat label="退款金额" value={formatAdminMoney(finance?.orders.refundedAmountCents)} detail={`退款订单 ${formatAdminNumber(finance?.orders.refunded)} 笔`} tone={finance?.orders.refundedAmountCents ? 'warning' : 'neutral'} />
        <AdminStat label="对账异常" value={formatAdminNumber((finance?.reconciliation.paidOrdersWithoutSucceededPayment || 0) + (finance?.reconciliation.succeededPaymentsWithoutPaidOrder || 0) + (finance?.reconciliation.amountMismatchPayments || 0))} detail="订单与支付流水不一致数量" tone="danger" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([['orders', '订单与支付'], ['coupons', '优惠券'], ['referrals', '邀请返利']] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value} className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${tab === value ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted'}`}>{label}</button>
        ))}
      </div>

      {error && <AdminError message={error} retry={load} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}

      {tab === 'orders' && (
        <>
          <AdminSectionCard title="订单查询" description="支持订单号、商品名和用户关键字搜索，并可按支付状态筛选。">
            <div className="flex flex-wrap items-center gap-2">
              <AdminInput aria-label="搜索订单" className="w-full sm:w-64" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="订单号、商品或用户" onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); setQuery(keyword) } }} />
              <AdminSelect aria-label="订单状态" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value) }} className="w-36">
                <option value="">全部状态</option>
                {orderStatuses.map((value) => <option key={value} value={value}>{labelOf(orderStatusLabels, value)}</option>)}
              </AdminSelect>
              <ControlButton variant="primary" size="sm" onClick={() => { setPage(1); setQuery(keyword) }}>查询</ControlButton>
              <ControlButton variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton>
            </div>
          </AdminSectionCard>

          <AdminTable columns={['订单号', '用户', '商品', '金额', '状态', '支付渠道', '时间', '操作']} minWidth={1180} caption="订单列表">
            {orders.items.map((order) => (
              <AdminRow key={order.id}>
                <AdminCell className="font-mono text-xs">{order.orderNo}</AdminCell>
                <AdminCell className="text-xs">{order.userUsername || order.userDisplayName || '-'}{order.userAccountId ? <span className="mt-1 block font-mono text-[11px] text-muted-foreground">#{order.userAccountId}</span> : null}</AdminCell>
                <AdminCell className="max-w-[220px]"><p className="truncate text-xs">{order.subject}</p>{order.pointsAmount ? <p className="mt-1 text-[11px] text-muted-foreground">积分 {formatAdminNumber(order.pointsAmount)}</p> : null}</AdminCell>
                <AdminCell>
                  <p className="text-xs font-medium">{formatAdminMoney(order.amountCents, order.currency)}</p>
                  {(order.promotionDiscountCents || order.couponDiscountCents) ? <p className="mt-1 text-[11px] text-muted-foreground">优惠 {formatAdminMoney((order.promotionDiscountCents || 0) + (order.couponDiscountCents || 0), order.currency)}</p> : null}
                </AdminCell>
                <AdminCell><StatusBadge tone={statusTone(order.status)}>{labelOf(orderStatusLabels, order.status)}</StatusBadge></AdminCell>
                <AdminCell className="text-xs">{order.provider || '-'}</AdminCell>
                <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(order.createdAt)}</AdminCell>
                <AdminCell>
                  <div className="flex flex-wrap gap-1.5">
                    <ControlButton variant="secondary" size="sm" onClick={() => setDetail(order)}>详情</ControlButton>
                    {canManage && order.status === 'pending' && <ControlButton variant="secondary" size="sm" disabled={acting === order.id} onClick={() => complete(order)}>标记已支付</ControlButton>}
                    {canManage && order.status === 'pending' && <ControlButton variant="danger" size="sm" disabled={acting === order.id} onClick={() => close(order)}>关闭</ControlButton>}
                    {canManage && order.status === 'paid' && <ControlButton variant="danger" size="sm" disabled={acting === order.id} onClick={() => refund(order)}><CircleDollarSign className="size-3.5" />退款</ControlButton>}
                  </div>
                </AdminCell>
              </AdminRow>
            ))}
            {!orders.items.length && <TableMessageRow colSpan={8} loading={loading} error={error} empty="没有匹配的订单" />}
          </AdminTable>
          <AdminPagination page={page} pageSize={20} total={orders.total} loading={loading} onChange={setPage} />
        </>
      )}

      {tab === 'coupons' && <CouponsPanel />}
      {tab === 'referrals' && <ReferralsPanel />}

      {detail && (
        <AdminDrawer open onClose={() => setDetail(null)} title={`订单 ${detail.orderNo}`} description={detail.subject}>
          <div className="flex flex-col gap-4">
            <AdminSectionCard title="支付信息" className="p-4">
              <AdminDefinition label="状态" value={<StatusBadge tone={statusTone(detail.status)}>{labelOf(orderStatusLabels, detail.status)}</StatusBadge>} />
              <AdminDefinition label="支付渠道" value={detail.provider} />
              <AdminDefinition label="渠道订单号" value={detail.providerOrderId} mono />
              <AdminDefinition label="应付金额" value={formatAdminMoney(detail.amountCents, detail.currency)} />
              <AdminDefinition label="订单原价" value={formatAdminMoney(detail.listAmountCents, detail.currency)} />
              <AdminDefinition label="促销优惠" value={formatAdminMoney(detail.promotionDiscountCents, detail.currency)} />
              <AdminDefinition label="优惠券抵扣" value={formatAdminMoney(detail.couponDiscountCents, detail.currency)} />
              <AdminDefinition label="过期时间" value={formatAdminDate(detail.expiresAt)} />
              <AdminDefinition label="支付时间" value={formatAdminDate(detail.paidAt)} />
              <AdminDefinition label="关闭时间" value={formatAdminDate(detail.closedAt)} />
              <AdminDefinition label="退款时间" value={formatAdminDate(detail.refundedAt)} />
            </AdminSectionCard>
            <AdminSectionCard title="商品与发放" className="p-4">
              <AdminDefinition label="用户" value={`${detail.userUsername || detail.userDisplayName || '-'}${detail.userAccountId ? ` (#${detail.userAccountId})` : ''}`} />
              <AdminDefinition label="商品标识" value={detail.productId} mono />
              <AdminDefinition label="商品类型" value={detail.productKind === 'plan' ? '订阅套餐' : '积分包'} />
              <AdminDefinition label="数量" value={formatAdminNumber(detail.quantity)} />
              <AdminDefinition label="发放积分" value={formatAdminNumber(detail.pointsAmount)} />
              <AdminDefinition label="每日积分" value={formatAdminNumber(detail.dailyPoints)} />
              <AdminDefinition label="有效期" value={detail.periodDays ? `${detail.periodDays} 天` : '一次性'} />
              <AdminDefinition label="创建时间" value={formatAdminDate(detail.createdAt)} />
            </AdminSectionCard>
            <AdminSectionCard title="支付快照" description="下单时的价格与优惠快照，用于事后核对。" className="p-4">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-5">{JSON.stringify(detail.pricingSnapshot ?? {}, null, 2)}</pre>
            </AdminSectionCard>
          </div>
        </AdminDrawer>
      )}
    </div>
  )
}

/* -------------------------------- 优惠券 -------------------------------- */

function CouponsPanel() {
  const session = useAdminSession()
  const canManage = session.can('commerce.manage')
  const [templates, setTemplates] = useState<CouponTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editor, setEditor] = useState<CouponTemplate | 'new' | null>(null)
  const [granting, setGranting] = useState<CouponTemplate | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError('')
    listCouponTemplates().then(setTemplates).catch((reason) => setError(reason instanceof Error ? reason.message : '优惠券加载失败')).finally(() => setLoading(false))
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading && !templates.length) return <AdminLoading label="正在加载优惠券" rows={3} />

  return (
    <div className="flex flex-col gap-4">
      {error && <AdminError message={error} retry={load} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}
      <AdminSectionCard
        title="优惠券模板"
        description="优惠券由模板定义面额、门槛与有效期，可向指定用户发放。"
        action={canManage ? <div className="flex gap-2"><ControlButton variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />刷新</ControlButton><ControlButton variant="primary" size="sm" onClick={() => setEditor('new')}><Plus className="size-3.5" />新增模板</ControlButton></div> : undefined}
      >
        <AdminTable columns={['名称', '类型', '面额 / 折扣', '使用门槛', '已领取 / 总量', '有效期', '状态', '操作']} minWidth={1000} caption="优惠券模板">
          {templates.map((template) => (
            <AdminRow key={template.id}>
              <AdminCell className="max-w-[220px]"><p className="truncate font-medium">{template.name}</p><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{template.id}</p></AdminCell>
              <AdminCell className="text-xs">{couponTypeLabel(template.discountType)}</AdminCell>
              <AdminCell className="text-xs">{couponValueLabel(template)}</AdminCell>
              <AdminCell className="text-xs">{template.minAmountCents ? formatAdminMoney(template.minAmountCents) : '无门槛'}</AdminCell>
              <AdminCell className="text-xs">{formatAdminNumber(template.claimedQuantity)} / {formatAdminNumber(template.totalQuantity)}</AdminCell>
              <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(template.startsAt)} → {formatAdminDate(template.endsAt)}</AdminCell>
              <AdminCell><StatusBadge tone={template.enabled ? 'success' : 'muted'}>{template.enabled ? '启用' : '停用'}</StatusBadge></AdminCell>
              <AdminCell>
                <div className="flex flex-wrap gap-1.5">
                  {canManage && <ControlButton variant="secondary" size="sm" onClick={() => setEditor(template)}><Pencil className="size-3.5" />编辑</ControlButton>}
                  {canManage && <ControlButton variant="secondary" size="sm" onClick={() => setGranting(template)}><Ticket className="size-3.5" />发放</ControlButton>}
                </div>
              </AdminCell>
            </AdminRow>
          ))}
          {!templates.length && <TableMessageRow colSpan={8} loading={loading} error={error} empty="暂无优惠券模板" />}
        </AdminTable>
      </AdminSectionCard>

      {editor && <CouponEditor template={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={(text) => { setMessage(text); setEditor(null); load() }} />}
      {granting && <CouponGrant template={granting} onClose={() => setGranting(null)} onSaved={(text) => { setMessage(text); setGranting(null) }} />}
    </div>
  )
}

function couponTypeLabel(value?: string) {
  if (value === 'amount') return '满减金额'
  if (value === 'percent') return '折扣比例'
  return value || '-'
}

function couponValueLabel(template: CouponTemplate) {
  if (template.discountType === 'percent') return `${Number(template.discountValue || 0)}%${template.maxDiscountCents ? `（最高 ${formatAdminMoney(template.maxDiscountCents)}）` : ''}`
  return formatAdminMoney(template.discountValue)
}

function CouponEditor({ template, onClose, onSaved }: { template?: CouponTemplate; onClose: () => void; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    const value = (key: string) => String(data.get(key) ?? '').trim()
    try {
      const type = value('discountType')
      const rawValue = Number(value('discountValue'))
      if (!Number.isFinite(rawValue) || rawValue <= 0) throw new Error('优惠数值必须大于零')
      const body = {
        id: template?.id,
        name: value('name'),
        discountType: type,
        discountValue: type === 'amount' ? Math.round(rawValue * 100) : rawValue,
        minAmountCents: Math.round((Number(value('minAmount')) || 0) * 100),
        maxDiscountCents: value('maxDiscount') ? Math.round(Number(value('maxDiscount')) * 100) : undefined,
        totalQuantity: Number(value('totalQuantity')) || 0,
        perUserLimit: Number(value('perUserLimit')) || 1,
        enabled: data.has('enabled'),
        startsAt: toIso(value('startsAt')),
        endsAt: toIso(value('endsAt')),
      }
      await saveCouponTemplate(body)
      onSaved(template ? '优惠券模板已保存' : '优惠券模板已创建')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminDrawer open onClose={onClose} title={template ? `编辑优惠券 ${template.name}` : '新增优惠券模板'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <Field label="模板名称"><AdminInput name="name" required maxLength={80} defaultValue={template?.name} /></Field>
          <Field label="优惠类型"><AdminSelect name="discountType" defaultValue={template?.discountType || 'amount'}><option value="amount">满减金额（元）</option><option value="percent">折扣比例（百分比）</option></AdminSelect></Field>
          <Field label="优惠数值" hint="满减填元；折扣填 0-100 的百分比。"><AdminInput name="discountValue" type="number" min="0.01" step="0.01" required defaultValue={template ? (template.discountType === 'percent' ? template.discountValue : (Number(template.discountValue) || 0) / 100) : ''} /></Field>
          <Field label="最低消费（元）"><AdminInput name="minAmount" type="number" min="0" step="0.01" defaultValue={template?.minAmountCents ? template.minAmountCents / 100 : 0} /></Field>
          <Field label="最高抵扣（元）" hint="仅折扣类型需要。"><AdminInput name="maxDiscount" type="number" min="0" step="0.01" defaultValue={template?.maxDiscountCents ? template.maxDiscountCents / 100 : ''} /></Field>
          <Field label="发放总量" hint="0 表示不限量。"><AdminInput name="totalQuantity" type="number" min="0" defaultValue={template?.totalQuantity ?? 0} /></Field>
          <Field label="每人限领"><AdminInput name="perUserLimit" type="number" min="1" defaultValue={template?.perUserLimit ?? 1} /></Field>
          <Field label="开始时间"><AdminInput name="startsAt" type="datetime-local" defaultValue={toLocalInput(template?.startsAt)} /></Field>
          <Field label="结束时间"><AdminInput name="endsAt" type="datetime-local" defaultValue={toLocalInput(template?.endsAt)} /></Field>
          <label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked={template?.enabled ?? true} />启用该模板</label>
        </fieldset>
        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <ControlButton variant="secondary" onClick={onClose} disabled={busy}>取消</ControlButton>
          <ControlButton type="submit" variant="primary" disabled={busy}>{busy ? '保存中' : '保存模板'}</ControlButton>
        </div>
      </form>
    </AdminDrawer>
  )
}

function CouponGrant({ template, onClose, onSaved }: { template: CouponTemplate; onClose: () => void; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    const target = String(data.get('target') ?? '').trim()
    try {
      if (!target) throw new Error('请填写用户名或用户 ID')
      const input = { templateId: template.id, quantity: Number(data.get('quantity')) || 1, ...(target.includes('-') && target.length > 20 ? { userId: target } : { username: target }) }
      await grantCoupon(input)
      onSaved('优惠券已发放')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发放失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminDrawer open onClose={onClose} width="sm:max-w-lg" title={`发放优惠券：${template.name}`}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <AdminNotice tone="neutral">发放会立即写入用户账户并记录审计日志。</AdminNotice>
        <fieldset disabled={busy} className="grid gap-4">
          <Field label="目标用户" hint="填写用户名或用户 ID。"><AdminInput name="target" required /></Field>
          <Field label="发放数量"><AdminInput name="quantity" type="number" min="1" max="100" defaultValue={1} /></Field>
        </fieldset>
        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <ControlButton variant="secondary" onClick={onClose} disabled={busy}>取消</ControlButton>
          <ControlButton type="submit" variant="primary" disabled={busy}><Gift className="size-3.5" />{busy ? '发放中' : '确认发放'}</ControlButton>
        </div>
      </form>
    </AdminDrawer>
  )
}

/* ------------------------------- 邀请返利 ------------------------------- */

function ReferralsPanel() {
  const session = useAdminSession()
  const canManage = session.can('commerce.manage')
  const [overview, setOverview] = useState<ReferralOverview | null>(null)
  const [relationships, setRelationships] = useState<Paged<ReferralRelationship>>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [rewards, setRewards] = useState<Paged<ReferralReward>>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true); setError('')
    Promise.all([getReferralOverview(), listReferralRelationships(), listReferralRewards(), getFinanceSummary()])
      .then(([data, relations, rewardPage, finance]) => { setOverview(data); setRelationships(relations); setRewards(rewardPage); setSummary(finance) })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '邀请返利数据加载失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading && !overview) return <AdminLoading label="正在加载邀请返利" rows={3} />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    const data = new FormData(event.currentTarget)
    try {
      await updateReferralProgram({
        enabled: data.has('enabled'),
        inviterPoints: Number(data.get('inviterPoints')) || 0,
        inviteeRewardType: String(data.get('inviteeRewardType') || 'points'),
        inviteePoints: Number(data.get('inviteePoints')) || 0,
        minimumPaidCents: Math.round((Number(data.get('minimumPaid')) || 0) * 100),
        coolingOffDays: Number(data.get('coolingOffDays')) || 0,
        inviterMonthlyLimit: Number(data.get('inviterMonthlyLimit')) || 0,
        campaignTotalLimit: Number(data.get('campaignTotalLimit')) || 0,
        autoFreezeRisk: data.has('autoFreezeRisk'),
      })
      setMessage('邀请奖励设置已保存')
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const program = overview?.program

  return (
    <div className="flex flex-col gap-4">
      {error && <AdminError message={error} retry={load} />}
      {message && <AdminNotice tone="success">{message}</AdminNotice>}

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <AdminStat label="点击" value={formatAdminNumber(overview?.stats.clicks)} />
        <AdminStat label="注册" value={formatAdminNumber(overview?.stats.registrations)} />
        <AdminStat label="达标" value={formatAdminNumber(overview?.stats.qualified)} tone="success" />
        <AdminStat label="待结算" value={formatAdminNumber(overview?.stats.pending)} tone="warning" />
        <AdminStat label="已结算" value={formatAdminNumber(overview?.stats.settled)} />
        <AdminStat label="风控标记" value={formatAdminNumber(overview?.stats.risky)} tone={overview?.stats.risky ? 'danger' : 'neutral'} />
      </div>

      <AdminSectionCard title="邀请奖励规则" description="设置邀请人积分、被邀请奖励类型、结算门槛与风控策略。">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset disabled={busy || !canManage} className="grid gap-4 sm:grid-cols-3">
            <Field label="邀请人积分"><AdminInput name="inviterPoints" type="number" min="0" defaultValue={program?.inviterPoints ?? 0} /></Field>
            <Field label="被邀请人奖励类型"><AdminSelect name="inviteeRewardType" defaultValue={program?.inviteeRewardType || 'points'}><option value="points">积分</option><option value="plan">套餐体验</option></AdminSelect></Field>
            <Field label="被邀请人积分"><AdminInput name="inviteePoints" type="number" min="0" defaultValue={program?.inviteePoints ?? 0} /></Field>
            <Field label="最低付费金额（元）"><AdminInput name="minimumPaid" type="number" min="0" step="0.01" defaultValue={(program?.minimumPaidCents ?? 0) / 100} /></Field>
            <Field label="冷静期（天）"><AdminInput name="coolingOffDays" type="number" min="0" defaultValue={program?.coolingOffDays ?? 0} /></Field>
            <Field label="邀请人每月上限" hint="0 表示不限。"><AdminInput name="inviterMonthlyLimit" type="number" min="0" defaultValue={program?.inviterMonthlyLimit ?? 0} /></Field>
            <Field label="活动总上限" hint="0 表示不限。"><AdminInput name="campaignTotalLimit" type="number" min="0" defaultValue={program?.campaignTotalLimit ?? 0} /></Field>
            <label className="flex items-center gap-2 self-end text-sm"><input name="enabled" type="checkbox" defaultChecked={program?.enabled ?? false} />启用邀请返利</label>
            <label className="flex items-center gap-2 self-end text-sm"><input name="autoFreezeRisk" type="checkbox" defaultChecked={program?.autoFreezeRisk ?? false} />自动冻结风险奖励</label>
          </fieldset>
          {canManage && <ControlButton type="submit" variant="primary" className="self-start" disabled={busy}>{busy ? '保存中' : '保存设置'}</ControlButton>}
        </form>
      </AdminSectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <AdminSectionCard title="邀请关系" description={`共 ${formatAdminNumber(relationships.total)} 条`}>
          <AdminTable columns={['邀请人', '被邀请人', '状态', '时间']} minWidth={520} caption="邀请关系">
            {relationships.items.map((item, index) => (
              <AdminRow key={String(item.id || index)}>
                <AdminCell className="text-xs">{item.inviterUsername || item.inviterUserId || '-'}</AdminCell>
                <AdminCell className="text-xs">{item.inviteeUsername || item.inviteeUserId || '-'}</AdminCell>
                <AdminCell><StatusBadge tone={statusTone(item.status)}>{item.status || '-'}</StatusBadge></AdminCell>
                <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(item.createdAt)}</AdminCell>
              </AdminRow>
            ))}
            {!relationships.items.length && <TableMessageRow colSpan={4} loading={false} empty="暂无邀请关系" />}
          </AdminTable>
        </AdminSectionCard>

        <AdminSectionCard title="奖励记录" description={`共 ${formatAdminNumber(rewards.total)} 条`}>
          <AdminTable columns={['奖励 ID', '积分', '状态', '结算时间']} minWidth={520} caption="奖励记录">
            {rewards.items.map((item, index) => (
              <AdminRow key={String(item.id || index)}>
                <AdminCell className="font-mono text-[11px]">{String(item.id || '-').slice(0, 12)}</AdminCell>
                <AdminCell className="text-xs">{formatAdminNumber(item.points)}</AdminCell>
                <AdminCell><StatusBadge tone={statusTone(item.status)}>{item.status || '-'}</StatusBadge></AdminCell>
                <AdminCell className="text-xs text-muted-foreground">{formatAdminDate(item.settledAt)}</AdminCell>
              </AdminRow>
            ))}
            {!rewards.items.length && <TableMessageRow colSpan={4} loading={false} empty="暂无奖励记录" />}
          </AdminTable>
        </AdminSectionCard>
      </div>

      <AdminSectionCard title="支付渠道统计" description="按支付渠道汇总订单与金额">
        <ProviderTable summary={summary} />
      </AdminSectionCard>
    </div>
  )
}

function ProviderTable({ summary }: { summary: FinanceSummary | null }) {
  if (!summary) return <p className="text-xs text-muted-foreground">暂无支付渠道统计。</p>
  if (!summary.providers.length) return <p className="text-xs text-muted-foreground">还没有产生订单的支付渠道。</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="text-muted-foreground"><tr>{['渠道', '订单', '已支付', '已退款', '支付金额', '退款金额'].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{summary.providers.map((provider) => <tr key={provider.provider} className="border-t border-border"><td className="py-2 pr-3">{provider.provider}</td><td className="py-2 pr-3">{provider.totalOrders}</td><td className="py-2 pr-3">{provider.paidOrders}</td><td className="py-2 pr-3">{provider.refundedOrders}</td><td className="py-2 pr-3">{formatAdminMoney(provider.paidAmountCents)}</td><td className="py-2 pr-3">{formatAdminMoney(provider.refundedAmountCents)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

export { Hourglass, Users }

