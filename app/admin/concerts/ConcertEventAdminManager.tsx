'use client'

import { useMemo, useState } from 'react'

type EventRecord = {
  id: string; title: string; subtitle: string | null; slug: string; venue: string | null; startDate: Date | string | null; endDate: Date | string | null
  description: string; sourceNote: string | null; timezone: string; registrationUrl: string | null; registrationEnabled: boolean; registrationLabel: string
  homepageFeatured: boolean; activityCenterVisible: boolean; allowMarking: boolean; allowDiscussion: boolean; status: string
  shows: Array<Record<string, unknown> & { id: string; date: Date | string }>
  timeline: Array<Record<string, unknown> & { id: string; date: Date | string }>
  tutorials: Array<Record<string, unknown> & { id: string }>
  markStats?: { wantToGo: number; hasTicket: number }
}

function day(value: Date | string | null) { return value ? (typeof value === 'string' ? value : value.toISOString()).slice(0, 10) : '' }
function rowsJson(rows: Array<Record<string, unknown>>) {
  return JSON.stringify(rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === 'date' ? day(value as Date | string | null) : value instanceof Date ? value.toISOString() : value]))), null, 2)
}

const blankEvent = { title: '', subtitle: '', slug: '', venue: '', startDate: '', endDate: '', description: '', sourceNote: '', timezone: 'Asia/Hong_Kong', registrationUrl: '', registrationEnabled: false, registrationLabel: '登记入口', homepageFeatured: false, activityCenterVisible: true, allowMarking: true, allowDiscussion: true, status: 'DRAFT' }

export function ConcertEventAdminManager({ initialEvents }: Readonly<{ initialEvents: EventRecord[] }>) {
  const [events, setEvents] = useState(initialEvents)
  const [selectedId, setSelectedId] = useState(initialEvents[0]?.id || '')
  const selected = useMemo(() => events.find((event) => event.id === selectedId) || null, [events, selectedId])
  const [form, setForm] = useState({ ...blankEvent })
  const [showsText, setShowsText] = useState('[]')
  const [timelineText, setTimelineText] = useState('[]')
  const [tutorialsText, setTutorialsText] = useState('[]')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  function choose(event: EventRecord | null) {
    setCreating(!event)
    setSelectedId(event?.id || '')
    setForm(event ? {
      title: event.title, subtitle: event.subtitle || '', slug: event.slug, venue: event.venue || '', startDate: day(event.startDate), endDate: day(event.endDate), description: event.description, sourceNote: event.sourceNote || '', timezone: event.timezone, registrationUrl: event.registrationUrl || '', registrationEnabled: event.registrationEnabled, registrationLabel: event.registrationLabel, homepageFeatured: event.homepageFeatured, activityCenterVisible: event.activityCenterVisible, allowMarking: event.allowMarking, allowDiscussion: event.allowDiscussion, status: event.status,
    } : { ...blankEvent })
    setShowsText(event ? rowsJson(event.shows) : '[]')
    setTimelineText(event ? rowsJson(event.timeline) : '[]')
    setTutorialsText(event ? rowsJson(event.tutorials) : '[]')
    setMessage('')
  }

  function field<K extends keyof typeof blankEvent>(key: K, value: (typeof blankEvent)[K]) { setForm((current) => ({ ...current, [key]: value })) }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setMessage('')
    try {
      if (creating) {
        const response = await fetch('/api/admin/concert-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || '创建失败')
        const reload = await fetch('/api/admin/concert-events', { cache: 'no-store' })
        const loaded = await reload.json()
        setEvents(loaded.events || [])
        choose((loaded.events || []).find((item: EventRecord) => item.id === data.event.id) || null)
        setMessage('专题已创建')
        return
      }
      if (!selected) throw new Error('请先选择专题')
      const shows = JSON.parse(showsText) as unknown
      const timeline = JSON.parse(timelineText) as unknown
      const tutorials = JSON.parse(tutorialsText) as unknown
      const response = await fetch(`/api/admin/concert-events/${encodeURIComponent(selected.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: form, shows, timeline, tutorials }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '保存失败')
      const reload = await fetch('/api/admin/concert-events', { cache: 'no-store' })
      const loaded = await reload.json()
      setEvents(loaded.events || [])
      const updated = (loaded.events || []).find((item: EventRecord) => item.id === selected.id) || null
      choose(updated)
      setMessage('专题已保存')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请检查 JSON 格式')
    } finally { setBusy(false) }
  }

  return <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
    <aside className="border border-[var(--border)] bg-[var(--surface)] p-3"><button type="button" onClick={() => choose(null)} className="mb-2 min-h-10 w-full bg-[var(--primary)] px-3 text-sm font-black text-white">＋ 新建专题</button><div className="space-y-1">{events.map((event) => <button key={event.id} type="button" onClick={() => choose(event)} className={`block min-h-10 w-full border px-3 py-2 text-left text-sm ${selectedId === event.id && !creating ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-transparent text-[var(--foreground)]'}`}><span className="block">{event.title}<span className="ml-2 text-[10px] text-[var(--foreground-muted)]">{event.status}</span></span><span className="mt-1 block text-[10px] text-[var(--foreground-muted)]">想看 {event.markStats?.wantToGo || 0} · 有票 {event.markStats?.hasTicket || 0}</span></button>)}</div></aside>
    <form onSubmit={save} className="space-y-4 border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-2">{([['title','专题名称'],['subtitle','副标题'],['slug','URL 路径'],['venue','场地'],['startDate','开始日期'],['endDate','结束日期'],['timezone','时区'],['registrationLabel','登记按钮文案'],['registrationUrl','登记入口 HTTPS URL']] as const).map(([key,label]) => <label key={key} className="space-y-1 text-xs font-bold text-[var(--foreground-muted)]">{label}<input required={key === 'title' || key === 'slug'} type={key.endsWith('Date') ? 'date' : 'text'} value={form[key]} onChange={(e) => field(key, e.target.value as never)} className="min-h-10 w-full border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]" /></label>)}
        <label className="space-y-1 text-xs font-bold text-[var(--foreground-muted)]">状态<select value={form.status} onChange={(e) => field('status', e.target.value)} className="min-h-10 w-full border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]">{['DRAFT','UPCOMING','REGISTRATION','WAITING_DRAW','SHOWING','ENDED','ARCHIVED'].map((status) => <option key={status}>{status}</option>)}</select></label>
      </div>
      <label className="block space-y-1 text-xs font-bold text-[var(--foreground-muted)]">专题说明<textarea required rows={4} value={form.description} onChange={(e) => field('description', e.target.value)} className="w-full border border-[var(--border)] bg-[var(--background)] p-3 text-sm text-[var(--foreground)]" /></label>
      <label className="block space-y-1 text-xs font-bold text-[var(--foreground-muted)]">资料来源与核验说明<textarea rows={3} value={form.sourceNote} onChange={(e) => field('sourceNote', e.target.value)} className="w-full border border-[var(--border)] bg-[var(--background)] p-3 text-sm text-[var(--foreground)]" /></label>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--foreground)]">{([['registrationEnabled','启用登记入口'],['homepageFeatured','首页展示'],['activityCenterVisible','活动中心展示'],['allowMarking','允许标记想看/有票'],['allowDiscussion','允许场次讨论']] as const).map(([key,label]) => <label key={key} className="inline-flex min-h-9 items-center gap-2"><input type="checkbox" checked={form[key]} onChange={(e) => field(key, e.target.checked as never)} />{label}</label>)}</div>
      {!creating ? <div className="space-y-4"><p className="text-xs leading-5 text-[var(--foreground-muted)]">场次、时间线和教程使用 JSON 列表维护。编辑现有条目保留其 ID；新增条目省略 id。教程步骤可选填 imageUrl（仅接受项目公开媒体库图片地址）、imageAlt、caution、linkUrl（仅 HTTPS）和 linkLabel。通过取消、归档、禁用或草稿状态保留历史，保存不会删除记录。</p>{([[showsText,setShowsText,'场次与歌单'],[timelineText,setTimelineText,'活动时间线'],[tutorialsText,setTutorialsText,'教程与步骤']] as const).map(([value,setter,label]) => <label key={label} className="block space-y-1 text-xs font-bold text-[var(--foreground-muted)]">{label}<textarea spellCheck={false} rows={label === '场次与歌单' ? 16 : 10} value={value} onChange={(e) => setter(e.target.value)} className="w-full border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs text-[var(--foreground)]" /></label>)}</div> : <p className="text-sm text-[var(--foreground-muted)]">创建专题后，再添加场次、时间线和教程。你可以从已有演唱会专题中复制 JSON 并调整。</p>}
      {message ? <p role="status" aria-live="polite" className="text-sm font-bold text-[var(--primary)]">{message}</p> : null}
      <button type="submit" disabled={busy} className="min-h-11 bg-[var(--primary)] px-5 text-sm font-black text-white disabled:opacity-50">{busy ? '正在保存…' : creating ? '创建专题' : '保存修改'}</button>
    </form>
  </div>
}
