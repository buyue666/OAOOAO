import type { AdminPaymentConfigSummary, AdminPaymentProviderConfig } from './admin-types'

export const MANUAL_INSTRUCTIONS_LIMIT = 16_000

export function canConfigureManualPayment(provider?: AdminPaymentProviderConfig): provider is AdminPaymentProviderConfig {
  return provider?.id === 'manual' && provider.checkoutKind === 'manual'
    && Array.isArray(provider.fields)
    && provider.fields.some((field) => field.key === 'instructions' && field.kind === 'textarea' && !field.secret)
}

export function manualPaymentInstructions(provider?: AdminPaymentProviderConfig): string {
  const field = provider?.fields?.find((item) => item.key === 'instructions' && !item.secret)
  return typeof field?.value === 'string' ? field.value : ''
}

export function manualPaymentInput(provider: AdminPaymentProviderConfig, enabled: boolean, instructions: string) {
  if (!canConfigureManualPayment(provider)) throw new Error('当前系统未返回可编辑的人工收款配置，请重新读取。')
  if (instructions.length > MANUAL_INSTRUCTIONS_LIMIT) throw new Error('收款说明不能超过 16000 个字符。')
  if (enabled && !instructions.trim()) throw new Error('启用人工收款前，请填写提供给购买者的收款说明。')
  return { providerId: 'manual', enabled, values: { instructions: instructions.trim() } }
}

export function assertManualPaymentSaved(payload: unknown, expected: ReturnType<typeof manualPaymentInput>): asserts payload is AdminPaymentConfigSummary {
  const summary = payload as Partial<AdminPaymentConfigSummary> | null
  const matches = Array.isArray(summary?.providers) ? summary.providers.filter((provider) => provider?.id === 'manual') : []
  const saved = matches.length === 1 ? matches[0] : undefined
  const ready = expected.enabled && Boolean(expected.values.instructions)
  if (!canConfigureManualPayment(saved) || saved.enabled !== expected.enabled
    || manualPaymentInstructions(saved) !== expected.values.instructions
    || saved.ready !== ready || saved.checkoutReady !== ready) {
    throw new Error('服务端未确认人工收款配置保存，请重新读取后核对。')
  }
}
