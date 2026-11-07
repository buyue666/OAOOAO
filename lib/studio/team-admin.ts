/** Keep administrator-entered yuan exact when converting to the cents contract. */
export function teamPlanPriceCents(value: string): number | null {
  if (!value.trim()) return null
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('每席价格最多保留两位小数。')
  const [yuan, cents = ''] = value.trim().split('.')
  const result = Number(yuan) * 100 + Number(cents.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result < 1 || result > 100000000) throw new Error('每席价格须为 0.01 至 1,000,000 元。')
  return result
}

export function teamPlanStorageBytes(gb: string): number {
  const result = Math.round(Number(gb) * 1024 ** 3)
  if (!gb.trim() || !Number.isSafeInteger(result) || result < 1 || result > 1024 ** 5) throw new Error('请填写有效的团队总容量，最大为 1 PB。')
  return result
}
