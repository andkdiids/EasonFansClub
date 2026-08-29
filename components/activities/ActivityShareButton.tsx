'use client'

import type { ShareCardData } from '@/lib/share-card'
import { ShareButton } from '@/components/share/ShareButton'

export function ActivityShareButton({ data, title, text }: Readonly<{ data: ShareCardData; title: string; text?: string }>) {
  return <ShareButton data={data} linkTitle={title} linkText={text} label="分享活动" triggerClassName="min-h-10 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-black text-[var(--primary)] hover:bg-[var(--navigation-active)]" messageClassName="text-xs font-black text-[var(--success)]" />
}
