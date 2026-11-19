import { useId, useState } from 'react'
import { ImageUp, QrCode } from 'lucide-react'
import { safeBrandImageUrl } from '@/lib/studio/site-brand'
import type { WechatContact } from '@/lib/studio/wechat-contact'
import { AdminField, AdminInput, AdminNotice, AdminSectionCard } from './admin-kit'
import { ControlButton } from './ui'

async function prepareQrImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('请选择不大于 8 MB 的 PNG、JPEG 或 WebP 图片。')
  const bitmap = await createImageBitmap(file)
  try {
    const ratio = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法读取二维码图片，请改用图片链接。')
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = false
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/png')
    if (data.length > 'data:image/png;base64,'.length + Math.ceil((220 * 1024) / 3) * 4) throw new Error('二维码图片太复杂，请裁剪至二维码区域后重试。')
    return data
  } finally { bitmap.close() }
}

export function AdminWechatContactFields({ value, disabled, onChange }: { value: WechatContact; disabled: boolean; onChange: (value: WechatContact) => void }) {
  const inputId = useId()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const draftUpload = value.imageUrl.startsWith('data:image/png;base64,')
  const preview = draftUpload ? value.imageUrl : safeBrandImageUrl(value.imageUrl)
  return <AdminSectionCard title="工作台微信二维码" description="在工作台侧栏底部显示微信图标。用户通过图标打开二维码；此设置独立于微信登录。">
    <fieldset disabled={disabled || reading} className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
      <legend className="sr-only">微信入口配置</legend>
      <div className="min-w-0 space-y-4">
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} />在工作台显示微信图标</label>
        <AdminField label="二维码图片地址" hint="可粘贴图片链接，也可直接上传二维码。建议使用清晰的正方形图片。"><AdminInput value={value.uploaded ? '' : value.imageUrl} placeholder={value.uploaded ? '已使用上传图片；输入链接可替换' : 'https://… 或站内图片路径'} maxLength={2048} onChange={event => { setError(''); onChange({ ...value, imageUrl: event.target.value, uploaded: false }) }} /></AdminField>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted focus-within:ring-2 focus-within:ring-ring"><ImageUp aria-hidden="true" className="size-4" />{reading ? '正在读取图片…' : '上传二维码'}<input id={inputId} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            setError(''); setReading(true)
            try { const imageUrl = await prepareQrImage(file); onChange({ ...value, imageUrl, uploaded: true }) }
            catch (reason) { setError(reason instanceof Error ? reason.message : '图片读取失败，请检查图片后重试。') }
            finally { setReading(false) }
          }} /></label>
          {preview && <ControlButton type="button" variant="secondary" className="min-h-11" onClick={() => onChange({ ...value, enabled: false, imageUrl: '', uploaded: false })}>移除图片</ControlButton>}
        </div>
        <AdminField label="二维码下方说明" hint="选填，例如：扫码关注 OAO，获取创作更新。"><AdminInput value={value.caption} maxLength={100} onChange={event => onChange({ ...value, caption: event.target.value })} /></AdminField>
        {error && <AdminNotice tone="danger">{error}</AdminNotice>}
      </div>
      <figure className="m-0 w-fit self-start rounded-lg border border-border bg-muted/30 p-3">
        <div className="grid size-36 place-items-center overflow-hidden rounded-md border border-border bg-background">
          {preview ? <img key={preview} src={preview} alt="微信二维码预览" referrerPolicy="no-referrer" className="size-full object-contain" onError={() => setError('二维码图片无法加载，请检查地址或重新上传。')} /> : <QrCode aria-hidden="true" className="size-8 text-muted-foreground" />}
        </div>
        <figcaption className="mt-2 text-center text-xs text-muted-foreground">二维码预览</figcaption>
      </figure>
    </fieldset>
  </AdminSectionCard>
}
