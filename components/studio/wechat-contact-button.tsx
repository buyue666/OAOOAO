import { useState } from 'react'
import { Popover } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeWechatContact } from '@/lib/studio/wechat-contact'
import { useUiText } from '@/lib/studio/i18n'

export function WechatContactButton({ config, collapsed = false, mobile = false }: { config: unknown; collapsed?: boolean; mobile?: boolean }) {
  const tx = useUiText()
  const contact = normalizeWechatContact(config)
  if (!contact.enabled || !contact.imageUrl) return null
  return <Popover.Root>
    <Popover.Trigger aria-label={tx('微信二维码')} title={collapsed ? tx('微信二维码') : undefined} className={cn('flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground', collapsed ? 'justify-center px-0' : 'text-left')}>
      <svg className="size-5 shrink-0" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 3C4.8 3 1.2 5.8 1.2 9.4a6 6 0 0 0 2.5 4.7l-.7 2.4 2.8-1.4a10 10 0 0 0 3.5.7 6.1 6.1 0 0 1-.5-2.4c0-3.6 3.4-6.5 7.7-6.5.3 0 .5 0 .8.1C16.1 4.7 13 3 9.4 3ZM6.6 7.1a1 1 0 1 1 0 2.1 1 1 0 0 1 0-2.1Zm5.5 0a1 1 0 1 1 0 2.1 1 1 0 0 1 0-2.1Z"/><path d="M23 13.4c0-3-2.9-5.4-6.4-5.4s-6.5 2.4-6.5 5.4 2.9 5.5 6.5 5.5a8 8 0 0 0 2.6-.5l2.2 1.1-.6-1.9a5.1 5.1 0 0 0 2.2-4.2Zm-8.7-.6a.9.9 0 1 1 0-1.9.9.9 0 0 1 0 1.9Zm4.6 0a.9.9 0 1 1 0-1.9.9.9 0 0 1 0 1.9Z"/></svg>
      {!collapsed && <span>{tx('微信')}</span>}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content data-wechat-contact-popover side={mobile ? 'top' : 'right'} align={mobile ? 'start' : 'end'} sideOffset={8} collisionPadding={12} aria-label={tx('微信二维码')} className="z-[80] w-52 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <p className="text-sm font-semibold">{tx('微信二维码')}</p>
          <Popover.Close aria-label={tx('关闭微信二维码')} className="-mr-1 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:size-7"><X className="size-4" aria-hidden="true" /></Popover.Close>
        </div>
        <QrPreview key={contact.imageUrl} url={contact.imageUrl} />
        <p className="mt-2 break-words text-center text-xs leading-5 text-muted-foreground">{contact.caption || tx('打开微信，扫一扫') }</p>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}

function QrPreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  const tx = useUiText()
  return failed ? <p role="status" className="rounded-lg border border-border p-3 text-center text-xs text-muted-foreground">{tx('暂时无法加载二维码')}</p> : <img src={url} alt={tx('微信扫码图片')} referrerPolicy="no-referrer" onError={() => setFailed(true)} className="mx-auto aspect-square w-full rounded-lg bg-white object-contain p-1" />
}
