import type { ObjectStorageSettings, ObjectStorageUpdateInput } from './admin-types'

export const CREATIVE_STORAGE_NOTICE = '支持 Cloudflare R2 与 S3 兼容存储。启用后新素材保存到对象存储，已有素材仍从原位置读取。'

export function storageUpdateInput(draft: ObjectStorageSettings, accessKeyId: string, secretAccessKey: string): ObjectStorageUpdateInput {
  if (draft.provider === 'vercel-blob') throw new Error('Vercel Blob 由项目集成管理，无需填写或保存 S3 配置')
  return {
    provider: draft.provider || 's3',
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
  if(result.writeVerified===true&&result.readVerified===true&&result.deleteVerified===true)return '存储桶访问、上传、读取和删除检测均通过，测试文件已清理。'
  return `已保存配置的存储桶可访问；${write}。`
}

export function assertStorageSaved(payload: unknown, expected: ObjectStorageUpdateInput) {
  const outer = record(payload)
  if (!outer || ('code' in outer && outer.code !== 0)) throw new Error('服务端未确认存储配置保存，请刷新后核对')
  const saved = record(outer.data) ?? outer
  for (const key of ['enabled', 'endpoint', 'region', 'bucket', 'prefix', 'forcePathStyle'] as const) {
    if (saved[key] !== expected[key]) throw new Error('服务端未确认存储配置保存，请刷新后核对')
  }
}
