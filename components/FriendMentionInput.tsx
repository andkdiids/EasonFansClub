'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'

export type MentionDraft = {
  userId: string
  startIndex: number
  endIndex: number
  displayText: string
}

type MentionFriend = {
  id: string
  uid: number
  name: string
  avatarUrl: string | null
}

const mentionTerminator = /[\s,，.。!?！？;；:：()[\]{}]/

function activeMention(value: string, caret: number) {
  const beforeCaret = value.slice(0, caret)
  const at = beforeCaret.lastIndexOf('@')
  if (at < 0) return null
  const query = beforeCaret.slice(at + 1)
  if (mentionTerminator.test(query) || query.includes('@') || query.length > 50) return null
  return { start: at, end: caret, query }
}

function reconcileMentions(previous: string, next: string, mentions: MentionDraft[]) {
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < previous.length - prefix
    && suffix < next.length - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1
  const oldEditEnd = previous.length - suffix
  const delta = next.length - previous.length

  return mentions.flatMap((mention) => {
    const shifted = mention.startIndex >= oldEditEnd
      ? { ...mention, startIndex: mention.startIndex + delta, endIndex: mention.endIndex + delta }
      : mention.endIndex <= prefix
        ? mention
        : null
    if (!shifted || next.slice(shifted.startIndex, shifted.endIndex) !== shifted.displayText) return []
    return [shifted]
  })
}

export function FriendMentionInput({
  textareaRef,
  value,
  mentions,
  onChange,
  onMentionsChange,
  onSubmitShortcut,
}: Readonly<{
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  mentions: MentionDraft[]
  onChange: (value: string) => void
  onMentionsChange: (mentions: MentionDraft[]) => void
  onSubmitShortcut: () => void
}>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)
  const historyEntryRef = useRef(false)
  const [trigger, setTrigger] = useState<{ start: number; end: number; query: string } | null>(null)
  const [friends, setFriends] = useState<MentionFriend[]>([])
  const [loading, setLoading] = useState(false)

  function closePicker(useHistory = true) {
    setTrigger(null)
    setFriends([])
    if (useHistory && historyEntryRef.current && window.history.state?.friendMentionPicker) {
      window.history.back()
    }
    historyEntryRef.current = false
  }

  function refreshTrigger(nextValue = value) {
    if (composingRef.current) return
    const input = textareaRef.current
    const next = activeMention(nextValue, input?.selectionStart ?? nextValue.length)
    if (!next) {
      closePicker()
      return
    }
    if (!trigger && !historyEntryRef.current) {
      window.history.pushState({ ...window.history.state, friendMentionPicker: true }, '')
      historyEntryRef.current = true
    }
    setTrigger(next)
  }

  useEffect(() => {
    if (!trigger) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/friends/mentions?q=${encodeURIComponent(trigger.query)}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await response.json().catch(() => ({}))
        setFriends(response.ok && Array.isArray(data.friends) ? data.friends : [])
      } catch {
        if (!controller.signal.aborted) setFriends([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [trigger])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (trigger && !rootRef.current?.contains(event.target as Node)) closePicker()
    }
    const pop = () => {
      if (!historyEntryRef.current) return
      historyEntryRef.current = false
      closePicker(false)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('popstate', pop)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('popstate', pop)
    }
  }, [trigger])

  function selectFriend(friend: MentionFriend) {
    if (!trigger) return
    const displayText = `@${friend.name}`
    const nextValue = `${value.slice(0, trigger.start)}${displayText} ${value.slice(trigger.end)}`
    const nextMention = {
      userId: friend.id,
      startIndex: trigger.start,
      endIndex: trigger.start + displayText.length,
      displayText,
    }
    const kept = mentions.filter((mention) =>
      mention.endIndex <= trigger.start || mention.startIndex >= trigger.end,
    )
    const delta = displayText.length + 1 - (trigger.end - trigger.start)
    const shifted = kept.map((mention) => mention.startIndex >= trigger.end
      ? { ...mention, startIndex: mention.startIndex + delta, endIndex: mention.endIndex + delta }
      : mention)
    onChange(nextValue)
    onMentionsChange([...shifted, nextMention].sort((a, b) => a.startIndex - b.startIndex))
    closePicker()
    window.requestAnimationFrame(() => {
      const caret = nextMention.endIndex + 1
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caret, caret)
    })
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape' && trigger) {
      event.preventDefault()
      closePicker()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !trigger && !composingRef.current) {
      event.preventDefault()
      onSubmitShortcut()
    }
  }

  return (
    <div ref={rootRef} className="relative mt-3">
      {trigger ? (
        <div role="listbox" aria-label="选择要提及的好友" className="absolute bottom-full left-0 z-[90] mb-2 max-h-56 w-full max-w-md overflow-y-auto border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_24px_rgba(2,12,27,.18)]">
          {loading ? <p className="px-3 py-3 text-sm font-bold text-[var(--foreground-muted)]">正在查找好友…</p> : null}
          {!loading && !friends.length ? <p className="px-3 py-3 text-sm font-bold text-[var(--foreground-muted)]">没有匹配的好友</p> : null}
          {friends.map((friend) => (
            <button
              key={friend.id}
              type="button"
              role="option"
              aria-selected="false"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectFriend(friend)}
              className="flex min-h-12 w-full items-center gap-3 border-b border-[var(--border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--navigation-active)]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                <SafeAvatar src={friend.avatarUrl} name={friend.name} uid={friend.uid} />
              </span>
              <span className="min-w-0 truncate text-sm font-black text-[var(--foreground)]">{friend.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          const next = event.target.value
          onMentionsChange(reconcileMentions(value, next, mentions))
          onChange(next)
          window.requestAnimationFrame(() => refreshTrigger(next))
        }}
        onClick={() => refreshTrigger()}
        onKeyUp={(event) => {
          if (event.key.startsWith('Arrow')) refreshTrigger()
        }}
        onKeyDown={keyDown}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={(event) => {
          composingRef.current = false
          refreshTrigger(event.currentTarget.value)
        }}
        rows={5}
        className="w-full rounded-lg border border-sky-100 px-4 py-2 outline-none ring-brand-500/20 focus:ring-4"
        placeholder="写下你的回复，输入 @ 提及好友…"
      />
    </div>
  )
}
