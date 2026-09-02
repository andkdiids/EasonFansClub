'use client'

import { countReplyCharacters, REPLY_MAX_LENGTH } from '@/lib/reply-length'

export function ReplyLengthCounter({ value, maxLength = REPLY_MAX_LENGTH, className = '' }: Readonly<{ value: string; maxLength?: number; className?: string }>) {
  const actualLength = countReplyCharacters(value)
  const exceededBy = Math.max(0, actualLength - maxLength)
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-bold ${exceededBy ? 'text-red-600' : 'text-slate-400'} ${className}`} aria-live="polite">
      <span>{actualLength} / {maxLength}</span>
      {exceededBy ? <span>超过 {exceededBy} 字</span> : null}
    </span>
  )
}
