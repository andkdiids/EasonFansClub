'use client'

import { useEffect, useState } from 'react'
import { normalizeTopicName, MAX_POST_TOPICS } from '@/lib/post-topics'

type SuggestedTopic = { id: string; name: string; postCount: number; participantCount: number; isOfficial: boolean }

export function PostTopicPicker({ value, onChange, error }: Readonly<{ value: string[]; onChange: (next: string[]) => void; error?: string }>) {
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<SuggestedTopic[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const keyword = input.trim()
    if (!keyword) {
      setSuggestions([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetch(`/api/topics?search=${encodeURIComponent(keyword)}`, { cache: 'no-store', signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ topics?: SuggestedTopic[] }> : { topics: [] })
        .then((payload) => setSuggestions(Array.isArray(payload.topics) ? payload.topics : []))
        .catch(() => undefined)
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [input])

  function add(name: string) {
    const normalized = normalizeTopicName(name)
    if (!normalized) return
    const key = normalized.toLocaleLowerCase('en-US')
    if (value.some((item) => item.toLocaleLowerCase('en-US') === key)) {
      setInput('')
      setOpen(false)
      return
    }
    if (value.length >= MAX_POST_TOPICS) return
    onChange([...value, normalized])
    setInput('')
    setOpen(false)
  }

  function remove(name: string) {
    const key = name.toLocaleLowerCase('en-US')
    onChange(value.filter((item) => item.toLocaleLowerCase('en-US') !== key))
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-black text-slate-700">添加话题</span>
        <span className="text-xs font-bold text-slate-400">{value.length}/{MAX_POST_TOPICS}</span>
      </div>
      {value.length ? <div className="flex flex-wrap gap-2">{value.map((name) => <button key={name} type="button" onClick={() => remove(name)} className="border border-sky-200 px-2 py-1 text-sm font-black text-brand-700">#{name} ×</button>)}</div> : null}
      <div className="relative">
        <input
          value={input}
          onChange={(event) => { setInput(event.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              add(input)
            }
          }}
          disabled={value.length >= MAX_POST_TOPICS}
          placeholder={value.length >= MAX_POST_TOPICS ? '已达到 5 个话题上限' : '输入话题名称，回车添加'}
          className="w-full border border-sky-100 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-brand-400"
          aria-label="添加话题"
        />
        {open && input.trim() && value.length < MAX_POST_TOPICS ? (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto border border-sky-100 bg-white p-1 shadow-lg">
            {suggestions.map((topic) => <button key={topic.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => add(topic.name)} className="block w-full px-3 py-2 text-left text-sm font-bold hover:bg-sky-50">#{topic.name} <span className="text-xs text-slate-400">{topic.postCount} 篇帖子</span>{topic.isOfficial ? <span className="ml-2 text-xs text-amber-700">官方</span> : null}</button>)}
            {normalizeTopicName(input) && !suggestions.some((topic) => topic.name.toLocaleLowerCase('en-US') === normalizeTopicName(input)?.toLocaleLowerCase('en-US')) ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => add(input)} className="block w-full border-t border-sky-50 px-3 py-2 text-left text-sm font-black text-brand-700">创建 #{normalizeTopicName(input)}</button> : null}
            {!suggestions.length && !normalizeTopicName(input) ? <p className="px-3 py-2 text-xs font-bold text-slate-400">只能使用中文、英文、数字或下划线</p> : null}
          </div>
        ) : null}
      </div>
      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
      <p className="text-xs font-bold text-slate-400">正文中的 #话题也会自动识别；同一话题只会关联一次。</p>
    </section>
  )
}
