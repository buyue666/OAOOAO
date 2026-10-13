import type { ObjectStorageSettings, ObjectStorageUpdateInput } from './admin-types'

export const CREATIVE_STORAGE_NOTICE = '当前生成素材保存在服务器，对象存储写入尚未接入。'

export function storageUpdateInput(draft: ObjectStorageSettings, accessKeyId: string, secretAccessKey: string): ObjectStorageUpdateInput {
  if (draft.enabled) throw new Error('对象存储写入尚未接入，不能保存启用状态。请明确取消“启用外部存储”后再保存；现有配置不会自动改变。')
  return {
    enabled: draft.enabled,
    endpoint: draft.endpoint,
    region: draft.region,
    bucket: draft.bucket,
    prefix: draft.prefix,
    forcePathStyle: draft.forcePathStyle,
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {}),
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function storageTestMessage(payload: unknown): string {
  const outer = record(payload)
  if (!outer || ('code' in outer && outer.code !== 0)) throw new Error('服务端未确认对象存储检测结果')
  const result = record(outer.data) ?? outer
  if (result.ok !== true || result.bucketAccessible !== true) throw new Error('服务端未确认存储桶可访问')
  const write = result.writeVerified === true ? '服务端报告写入已验证' : result.writeVerified === false ? '未验证写入权限' : '服务端未返回写入验证状态'
  return `已保存配置的存储桶可访问；${write}。生成素材的对象存储写入仍未接入。`
}

export function assertStorageSaved(payload: unknown, expected: ObjectStorageUpdateInput) {
  const outer = record(payload)
  if (!outer || ('code' in outer && outer.code !== 0)) throw new Error('服务端未确认存储配置保存，请刷新后核对')
  const saved = record(outer.data) ?? outer
  for (const key of ['enabled', 'endpoint', 'region', 'bucket', 'prefix', 'forcePathStyle'] as const) {
    if (saved[key] !== expected[key]) throw new Error('服务端未确认存储配置保存，请刷新后核对')
  }
}
