'use client'

import { useCallback, useEffect, useState } from 'react'
import { buildCantoneseTeachingEditPayload, hasCantoneseTeachingEditChanges, type CantoneseTeachingEditValues } from '@/lib/cantonese-admin-edit-payload'

type Tab = 'packs' | 'teaching' | 'question' | 'audio'
type Pack = {
  lessonId: string; lessonNumber: number; title: string; subtitle: string | null; description: string
  teachingCount: number; questionCount: number; audioCount: number; speakingCount: number; status: string
  jyutping?: { needsPronunciation: number; candidates: number; reviewRequired: number; missing: number; verified: number }
}
type PreviewLine = {
  id: string; decision: string; candidate: Record<string, unknown>
  current: { status: string; assetStatus: string | null; updatedAt: string | null } | null
  diff: Array<{ field: string; old: string; next: string; truncated?: boolean }>; expectedUpdatedAt: string | null
}
type PackPreview = {
  lesson: Pack & { jyutping: NonNullable<Pack['jyutping']> }
  summary: Record<'content' | 'questions' | 'audio', { new: number; updateAvailable: number; approvedSkipped: number; unchanged: number; blocked: number; total: number }>
  items: { content: PreviewLine[]; questions: PreviewLine[]; audio: PreviewLine[] }
  writes: false
}
type ReviewItem = Record<string, unknown> & { externalId: string; status: string }
type JyutpingValueSource = 'RECORDED' | 'CURRENT_DIGEST_MATCH' | 'UNAVAILABLE'
type ReviewLog = {
  id?: string
  action?: string
  kind?: string
  type?: string
  oldStatus?: string | null
  newStatus?: string | null
  reason?: string | null
  createdAt?: string | null
  reviewer?: { id?: string; nickname?: string | null } | null
  jyutping?: string | null
  beforeJyutping?: string | null
  afterJyutping?: string | null
  jyutpingValueSource?: JyutpingValueSource
}
type ReviewDetail = { item: ReviewItem; logs: ReviewLog[] }

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'packs', label: '课程候选' }, { id: 'teaching', label: '教学内容' },
  { id: 'question', label: '题目' }, { id: 'audio', label: '音频' },
]
const statuses = [
  ['CONTENT_REVIEW_REQUIRED', '待审核'], ['APPROVED', '已通过'], ['REJECTED', '已退回'], ['DRAFT', '草稿'], ['ALL', '全部'],
]
const decisionLabels: Record<string, string> = {
  CREATE_PENDING: 'NEW', UPDATE_AVAILABLE: 'UPDATE_AVAILABLE', CANDIDATE_UPDATE_AVAILABLE: '候选可更新',
  SKIPPED_ALREADY_APPROVED: 'APPROVED_PROTECTED', SKIPPED_EXISTING: 'UNCHANGED',
  AUDIO_ASSET_REVIEW_REQUIRED: 'BLOCKED',
}
const decisionClasses: Record<string, string> = {
  CREATE_PENDING: 'border-blue-200 bg-blue-50 text-blue-800',
  UPDATE_AVAILABLE: 'border-amber-200 bg-amber-50 text-amber-900',
  CANDIDATE_UPDATE_AVAILABLE: 'border-amber-200 bg-amber-50 text-amber-900',
  SKIPPED_ALREADY_APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  SKIPPED_EXISTING: 'border-slate-200 bg-slate-50 text-slate-700',
  AUDIO_ASSET_REVIEW_REQUIRED: 'border-rose-200 bg-rose-50 text-rose-800',
}
const statusLabels: Record<string, string> = {
  NOT_IMPORTED: '未导入', PARTIAL: '部分导入', IMPORTED: '已导入', UPDATE_AVAILABLE: '有候选更新',
}
const fieldLabels: Record<string, string> = {
  displayText: '显示文本', jyutping: '粤拼', translation: '中文意思', explanation: '教学说明', usageNote: '用法说明',
  requiresAudio: '需要标准音频', requiresSpeaking: '启用跟读', title: '标题', prompt: '题干', options: '选项',
  correctAnswer: '正确答案', prerequisiteContentIds: '前置教学', audioId: '音频引用', section: '课程小节',
}
const editFields: Array<[keyof CantoneseTeachingEditValues, string]> = [
  ['title', '标题'], ['displayText', '显示文本'], ['jyutping', '粤拼候选'], ['translation', '中文意思'], ['explanation', '教学说明'], ['usageNote', '用法说明'],
]

function text(value: unknown, fallback = '—') {
  return typeof value === 'string' && value.trim() ? value : fallback
}
function pretty(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('、') || '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
function optionsWithAnswers(candidate: Record<string, unknown>) {
  const options = Array.isArray(candidate.options) ? candidate.options as Array<{ id?: string; text?: string }> : []
  const answers = Array.isArray(candidate.correctAnswer) ? candidate.correctAnswer.map(String) : []
  return options.map((option) => ({ ...option, correct: option.id ? answers.includes(option.id) : false }))
}

function reviewDetailKey(type: Tab, externalId: string) {
  return `${type}:${externalId}`
}

export function reviewLogFinalJyutping(log: ReviewLog) {
  if (log.jyutpingValueSource === 'UNAVAILABLE') return '不可用（历史记录未保存粤拼）'
  if (Object.prototype.hasOwnProperty.call(log, 'afterJyutping')) return log.afterJyutping || '已清除'
  if (Object.prototype.hasOwnProperty.call(log, 'jyutping')) return log.jyutping || '已清除'
  return '不可用（历史记录未保存粤拼）'
}

export function reviewLogJyutpingDisplay(log: ReviewLog) {
  const hasBefore = Object.prototype.hasOwnProperty.call(log, 'beforeJyutping')
  const hasAfter = Object.prototype.hasOwnProperty.call(log, 'afterJyutping')
  if (log.jyutpingValueSource === 'CURRENT_DIGEST_MATCH') return `当前值与历史摘要匹配：${reviewLogFinalJyutping(log)}`
  if (hasBefore && hasAfter) return `${log.beforeJyutping || '已清除'} → ${log.afterJyutping || '已清除'}`
  return reviewLogFinalJyutping(log)
}

function reviewLogAction(log: ReviewLog) {
  return log.action || log.kind || log.type || '未知操作'
}

function reviewLogDate(value: string | null | undefined) {
  if (!value) return '时间未知'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN')
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { code?: string; message?: string }
  if (!response.ok) throw new Error(body.message || body.code || `HTTP_${response.status}`)
  return body
}

export function CantoneseAdminReviewCenter() {
  const [tab, setTab] = useState<Tab>('packs')
  const [packs, setPacks] = useState<Pack[]>([])
  const [packLoading, setPackLoading] = useState(true)
  const [selectedLesson, setSelectedLesson] = useState('')
  const [preview, setPreview] = useState<PackPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [reviewStatus, setReviewStatus] = useState('CONTENT_REVIEW_REQUIRED')
  const [lessonFilter, setLessonFilter] = useState('ALL')
  const [sourceFilter, setSourceFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [reviewTotal, setReviewTotal] = useState(0)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reviewDetails, setReviewDetails] = useState<Record<string, ReviewDetail>>({})
  const [reviewDetailLoading, setReviewDetailLoading] = useState('')
  const [reviewDetailErrors, setReviewDetailErrors] = useState<Record<string, string>>({})
  const [importMode, setImportMode] = useState<'new' | 'new-and-pending-updates'>('new')
  const [showImportConfirm, setShowImportConfirm] = useState(false)
  const [showAdoptConfirm, setShowAdoptConfirm] = useState<PreviewLine | null>(null)
  const [busyId, setBusyId] = useState('')
  const [editItem, setEditItem] = useState<ReviewItem | null>(null)
  const [editValues, setEditValues] = useState<CantoneseTeachingEditValues>({ title: '', body: '', displayText: '', jyutping: '', translation: '', explanation: '', usageNote: '' })
  const [rejectItem, setRejectItem] = useState<ReviewItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null)

  const loadPacks = useCallback(async () => {
    setPackLoading(true)
    try {
      const body = await readResponse<{ packs: Pack[] }>(await fetch('/api/admin/cantonese/seed-packs', { cache: 'no-store' }))
      setPacks(body.packs || [])
      if (!selectedLesson && body.packs?.[0]) setSelectedLesson(body.packs[0].lessonId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '课程候选加载失败') }
    finally { setPackLoading(false) }
  }, [selectedLesson])

  const loadReviewItems = useCallback(async () => {
    if (tab === 'packs') return
    setReviewLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ type: tab, status: reviewStatus, page: String(reviewPage) })
      if (lessonFilter !== 'ALL') params.set('lessonId', lessonFilter)
      if (sourceFilter !== 'ALL') params.set('source', sourceFilter)
      if (search.trim()) params.set('q', search.trim())
      const body = await readResponse<{ items: ReviewItem[]; total: number }>(await fetch(`/api/admin/cantonese/review?${params}`, { cache: 'no-store' }))
      setReviewItems(body.items || [])
      setReviewTotal(body.total || 0)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '审核列表加载失败') }
    finally { setReviewLoading(false) }
  }, [tab, reviewStatus, lessonFilter, sourceFilter, search, reviewPage])

  async function fetchReviewDetail(type: Tab, externalId: string) {
    const body = await readResponse<ReviewDetail>(await fetch(`/api/admin/cantonese/review/${type}/${encodeURIComponent(externalId)}`, { cache: 'no-store' }))
    if (!body.item || !Array.isArray(body.logs)) throw new Error('审核详情响应无效')
    return body
  }

  async function toggleReviewItem(item: ReviewItem) {
    const key = reviewDetailKey(tab, item.externalId)
    if (expanded === key) {
      setExpanded(null)
      return
    }
    setExpanded(key)
    if (reviewDetails[key] || reviewDetailLoading === key) return
    setReviewDetailLoading(key)
    setReviewDetailErrors((errors) => ({ ...errors, [key]: '' }))
    try {
      const detail = await fetchReviewDetail(tab, item.externalId)
      setReviewDetails((details) => ({ ...details, [key]: detail }))
    } catch (cause) {
      setReviewDetailErrors((errors) => ({ ...errors, [key]: cause instanceof Error ? cause.message : '审核记录加载失败' }))
    } finally {
      setReviewDetailLoading((current) => current === key ? '' : current)
    }
  }

  async function invalidateReviewDetails() {
    const activeKey = expanded
    setReviewDetails({})
    setReviewDetailErrors({})
    if (!activeKey) return
    const separator = activeKey.indexOf(':')
    const type = separator > 0 ? activeKey.slice(0, separator) : ''
    const externalId = separator > 0 ? activeKey.slice(separator + 1) : ''
    if (!['teaching', 'question', 'audio'].includes(type) || !externalId) {
      setExpanded(null)
      return
    }
    setReviewDetailLoading(activeKey)
    try {
      const detail = await fetchReviewDetail(type as Exclude<Tab, 'packs'>, externalId)
      setReviewDetails({ [activeKey]: detail })
    } catch (cause) {
      setReviewDetailErrors({ [activeKey]: cause instanceof Error ? cause.message : '审核记录加载失败' })
    } finally {
      setReviewDetailLoading((current) => current === activeKey ? '' : current)
    }
  }

  async function editLinkedTeaching(sourceId: string) {
    setError('')
    setBusyId(`edit:${sourceId}`)
    try {
      const detail = await fetchReviewDetail('teaching', sourceId)
      startEdit(detail.item)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '关联教学内容加载失败')
    } finally {
      setBusyId((current) => current === `edit:${sourceId}` ? '' : current)
    }
  }

  useEffect(() => { void loadPacks() }, [loadPacks])
  useEffect(() => { void loadReviewItems() }, [loadReviewItems])

  async function runPreview(lessonId: string) {
    setSelectedLesson(lessonId)
    setPreview(null)
    setImportResult(null)
    setPreviewLoading(true)
    setError('')
    setNotice('')
    try {
      const body = await readResponse<PackPreview>(await fetch('/api/admin/cantonese/review/import/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packId: lessonId }),
      }))
      if (body.writes !== false) throw new Error('预览响应未确认只读，已停止展示。')
      setPreview(body)
      setTab('packs')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '预览失败') }
    finally { setPreviewLoading(false) }
  }

  async function runImport() {
    if (!preview || !selectedLesson) return
    setBusyId('import')
    setError('')
    try {
      const body = await readResponse<Record<string, unknown>>(await fetch('/api/admin/cantonese/review/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: selectedLesson, selectedLessonId: selectedLesson, updateExistingCandidates: importMode === 'new-and-pending-updates', confirmed: true }),
      }))
      setShowImportConfirm(false)
      await runPreview(selectedLesson)
      setImportResult(body)
      setNotice('导入请求已完成；请核对下方逐类结果。导入不会批准内容，也不会生成音频。')
      await loadPacks()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败') }
    finally { setBusyId('') }
  }

  async function adoptCandidate(line: PreviewLine) {
    if (!selectedLesson || !line.expectedUpdatedAt) return
    setBusyId(line.id)
    setError('')
    try {
      await readResponse(await fetch('/api/admin/cantonese/review/import/adopt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: selectedLesson, confirmed: true, targetType: line.candidate.contentType ? 'teaching' : line.candidate.questionType ? 'question' : 'audio', targetId: line.id, expectedUpdatedAt: line.expectedUpdatedAt }),
      }))
      setShowAdoptConfirm(null)
      setNotice('新版已采纳为待审核候选，请重新审核。')
      await runPreview(selectedLesson)
      await loadPacks()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '采纳新版失败') }
    finally { setBusyId('') }
  }

  async function reviewAction(item: ReviewItem, action: string, reason?: string) {
    setBusyId(item.externalId)
    setError('')
    try {
      if (action === 'generate-audio') {
        await readResponse(await fetch(`/api/admin/cantonese/audio/${encodeURIComponent(item.externalId)}/generate`, { method: 'POST' }))
        await invalidateReviewDetails()
        setNotice('标准音频已生成或复用；审核状态仍需单独处理。')
        await loadReviewItems()
        return
      }
      await readResponse(await fetch(`/api/admin/cantonese/review/${tab}/${encodeURIComponent(item.externalId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      }))
      setRejectItem(null)
      setRejectReason('')
      await invalidateReviewDetails()
      setNotice(action === 'approve' ? '审核通过。' : action === 'reject' ? '已退回并记录原因。' : action === 'verify-jyutping' ? '粤拼已确认并记录审核人和时间。' : action === 'revoke-jyutping' ? '粤拼确认已撤销。' : '操作完成。')
      await loadReviewItems()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '审核操作失败') }
    finally { setBusyId('') }
  }

  function startEdit(item: ReviewItem) {
    setEditItem(item)
    setEditValues({
      title: text(item.title, ''), body: text(item.body, ''), displayText: text(item.displayText, ''),
      jyutping: text(item.jyutping, ''), translation: text(item.translation, ''), explanation: text(item.explanation, ''),
      usageNote: text(item.usageNote, ''),
    })
  }

  async function saveEdit() {
    if (!editItem) return
    const payload = buildCantoneseTeachingEditPayload(editItem, editValues)
    if (!hasCantoneseTeachingEditChanges(payload)) {
      setEditItem(null)
      setNotice('未检测到修改。')
      return
    }
    setBusyId(editItem.externalId)
    try {
      await readResponse(await fetch(`/api/admin/cantonese/review/teaching/${encodeURIComponent(editItem.externalId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }))
      await invalidateReviewDetails()
      setEditItem(null)
      setNotice('修改已保存，并重新进入待审核。')
      await loadReviewItems()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
    finally { setBusyId('') }
  }

  const heading = tabs.find((entry) => entry.id === tab)?.label || '课程候选'

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6">
      <header className="border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Admin · Cantonese</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">粤语课程审核中心 / 候选课程导入</h1>
            <p className="mt-1 text-sm text-slate-600">预览、核对和审核课程候选；审核状态与音频状态分别管理。</p>
          </div>
          <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">预览不会写入生产数据库</span>
        </div>
        <nav className="mt-5 flex gap-5 overflow-x-auto" aria-label="粤语管理模块">
          {tabs.map((entry) => <button key={entry.id} onClick={() => { setTab(entry.id); setError(''); setNotice('') }} className={`whitespace-nowrap border-b-2 px-1 pb-2 text-sm font-semibold ${tab === entry.id ? 'border-slate-900 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{entry.label}</button>)}
        </nav>
      </header>

      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {tab === 'packs' ? <section className="grid gap-5 xl:grid-cols-[minmax(280px,380px)_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-base font-bold text-slate-900">课程候选</h2><button className="text-xs text-slate-600 underline" onClick={() => void loadPacks()}>刷新</button></div>
          {packLoading ? <p className="text-sm text-slate-500">正在读取候选包…</p> : packs.length === 0 ? <p className="rounded-md border border-slate-200 p-4 text-sm text-slate-600">暂无可导入的课程候选包。</p> : packs.map((pack) => <article key={pack.lessonId} className={`rounded-lg border p-4 ${selectedLesson === pack.lessonId ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Lesson {String(pack.lessonNumber).padStart(2, '0')}</p><h3 className="mt-1 font-semibold text-slate-950">{pack.title}</h3><p className="mt-1 text-xs text-slate-600">{pack.subtitle || pack.description}</p></div><span className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">{statusLabels[pack.status] || pack.status}</span></div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs"><Count label="教学" value={pack.teachingCount} /><Count label="题目" value={pack.questionCount} /><Count label="音频" value={pack.audioCount} /><Count label="跟读" value={pack.speakingCount} /></div>
            <button disabled={previewLoading} onClick={() => void runPreview(pack.lessonId)} className="mt-3 min-h-9 w-full rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">{previewLoading && selectedLesson === pack.lessonId ? '正在预览…' : '预览候选内容'}</button>
          </article>)}
        </div>

        <div className="min-w-0 space-y-4">
          {!preview && <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">选择课程并点击“预览候选内容”。预览仅读取候选包和现有审核状态，不会写入数据库。</div>}
          {preview && <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950">Lesson {String(preview.lesson.lessonNumber).padStart(2, '0')} · {preview.lesson.title}</h2><p className="mt-1 text-sm text-slate-600">预览不会写入生产数据库。候选内容导入后仍为待审核，不会批准或生成音频。</p></div><div className="flex flex-wrap gap-2"><select aria-label="导入模式" value={importMode} onChange={(event) => setImportMode(event.target.value as typeof importMode)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="new">只导入新增内容</option><option value="new-and-pending-updates">新增 + 更新未批准候选</option></select><button onClick={() => setShowImportConfirm(true)} className="h-9 rounded-md border border-slate-900 bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700">导入待审核候选</button></div></div>

            <div className="grid gap-3 lg:grid-cols-3"><SummaryTable title="教学内容" summary={preview.summary.content} /><SummaryTable title="题目" summary={preview.summary.questions} /><SummaryTable title="音频" summary={preview.summary.audio} /></div>
            <JyutpingCounters stats={preview.lesson.jyutping} />

            <section className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">教学内容候选 · {preview.items.content.length}</h3>
              {preview.items.content.map((line) => <PreviewContentRow key={line.id} line={line} onAdopt={() => setShowAdoptConfirm(line)} busy={busyId === line.id} />)}
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">题目候选 · {preview.items.questions.length}</h3>
              {preview.items.questions.map((line) => <PreviewQuestionRow key={line.id} line={line} onAdopt={() => setShowAdoptConfirm(line)} busy={busyId === line.id} />)}
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">音频候选 · {preview.items.audio.length}</h3>
              {preview.items.audio.map((line) => <PreviewAudioRow key={line.id} line={line} onAdopt={() => setShowAdoptConfirm(line)} busy={busyId === line.id} />)}
            </section>
          </>}
        </div>
      </section> : <section className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <label className="space-y-1 text-xs font-semibold text-slate-600">审核状态<select value={reviewStatus} onChange={(event) => { setReviewStatus(event.target.value); setReviewPage(1) }} className="block h-9 min-w-36 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-900">{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">课程<select value={lessonFilter} onChange={(event) => { setLessonFilter(event.target.value); setReviewPage(1) }} className="block h-9 min-w-36 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-900"><option value="ALL">全部课程</option>{packs.map((pack) => <option key={pack.lessonId} value={pack.lessonId}>L{String(pack.lessonNumber).padStart(2, '0')} · {pack.title}</option>)}</select></label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">来源<select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setReviewPage(1) }} className="block h-9 min-w-36 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-900"><option value="ALL">全部来源</option><option value="COURSE_PACK_V6">课程包 V6</option><option value="LEGACY">旧候选</option></select></label>
          <label className="min-w-[220px] flex-1 space-y-1 text-xs font-semibold text-slate-600">搜索 ID / 关键词<input value={search} onChange={(event) => { setSearch(event.target.value); setReviewPage(1) }} placeholder="externalId、粤语文本、题干…" className="block h-9 w-full rounded-md border border-slate-300 px-3 text-sm font-normal text-slate-900" /></label>
          <button onClick={() => void loadReviewItems()} className="h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">搜索 / 刷新</button>
        </div>
        <div className="flex items-center justify-between text-sm text-slate-600"><span>{heading} · {reviewTotal} 条</span><span>{reviewLoading ? '正在加载…' : ''}</span></div>
        {reviewItems.length === 0 && !reviewLoading ? <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">暂无{heading}。课程候选可从“课程候选”标签预览。</div> : <div className="space-y-2">{reviewItems.map((item) => { const detailKey = reviewDetailKey(tab, item.externalId); return <ReviewCard key={item.externalId} tab={tab} item={item} detail={reviewDetails[detailKey]} detailLoading={reviewDetailLoading === detailKey} detailError={reviewDetailErrors[detailKey]} expanded={expanded === detailKey} busy={busyId === item.externalId} onToggle={() => void toggleReviewItem(item)} onAction={(action) => action === 'reject' ? setRejectItem(item) : void reviewAction(item, action)} onEdit={() => startEdit(item)} onEditTeaching={(sourceId) => void editLinkedTeaching(sourceId)} /> })}</div>}
        <div className="flex justify-end gap-2"><button disabled={reviewPage <= 1} onClick={() => setReviewPage((page) => page - 1)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">上一页</button><span className="px-2 py-1.5 text-sm text-slate-600">第 {reviewPage} 页</span><button disabled={reviewItems.length < 30} onClick={() => setReviewPage((page) => page + 1)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">下一页</button></div>
      </section>}

      {showImportConfirm && <ConfirmDialog title="确认导入候选课程" onCancel={() => setShowImportConfirm(false)} onConfirm={() => void runImport()} busy={busyId === 'import'} confirmLabel="确认导入待审核候选"><p>导入仅创建新增候选，{importMode === 'new-and-pending-updates' ? '并更新未批准的候选内容' : '不会更新现有候选'}。</p><p className="mt-2 font-semibold">不会自动批准内容，也不会生成标准音频。已批准内容始终受保护。</p></ConfirmDialog>}
      {showAdoptConfirm && <ConfirmDialog title="采纳已批准内容的新版本？" onCancel={() => setShowAdoptConfirm(null)} onConfirm={() => void adoptCandidate(showAdoptConfirm)} busy={busyId === showAdoptConfirm.id} confirmLabel="采纳并重新审核"><p>采纳后，该条内容会退回 CONTENT_REVIEW_REQUIRED；不会自动批准。</p><p className="mt-2 break-all text-xs text-slate-500">{showAdoptConfirm.id}</p></ConfirmDialog>}
      {rejectItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl"><h3 className="text-lg font-bold">退回内容</h3><p className="mt-1 text-sm text-slate-600">退回必须填写原因。</p><textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mt-3 min-h-28 w-full rounded-md border border-slate-300 p-3 text-sm" placeholder="填写修改意见" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setRejectItem(null)} className="rounded-md border px-3 py-2 text-sm">取消</button><button disabled={!rejectReason.trim() || busyId === rejectItem.externalId} onClick={() => void reviewAction(rejectItem, 'reject', rejectReason)} className="rounded-md bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">确认退回</button></div></div></div>}
      {editItem && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4"><div role="dialog" aria-modal="true" className="mx-auto my-8 w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-xl"><div className="flex items-start justify-between"><div><h3 className="text-lg font-bold">编辑教学内容</h3><p className="mt-1 text-xs text-slate-500">保存后会重新进入待审核；粤拼改动会使原确认失效。</p></div><button onClick={() => setEditItem(null)} aria-label="关闭">✕</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{editFields.map(([key, label]) => <label key={key} className="space-y-1 text-xs font-semibold text-slate-600">{label}<textarea rows={key === 'explanation' ? 3 : 2} value={editValues[key]} onChange={(event) => setEditValues((values) => ({ ...values, [key]: event.target.value }))} className="block w-full rounded-md border border-slate-300 p-2 text-sm font-normal text-slate-900" /></label>)}</div><label className="mt-3 block space-y-1 text-xs font-semibold text-slate-600">正文<textarea rows={3} value={editValues.body} onChange={(event) => setEditValues((values) => ({ ...values, body: event.target.value }))} className="block w-full rounded-md border border-slate-300 p-2 text-sm font-normal text-slate-900" /></label><div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditItem(null)} className="rounded-md border px-3 py-2 text-sm">取消</button><button onClick={() => void saveEdit()} disabled={!editValues.title.trim() || !editValues.body.trim() || busyId === editItem.externalId} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">保存并重新提交审核</button></div></div></div>}
      {importResult && <div role="status" className="fixed bottom-4 right-4 z-40 max-w-lg rounded-lg border border-slate-300 bg-white p-4 shadow-xl"><div className="flex items-center justify-between gap-4"><h3 className="font-bold">导入结果</h3><button onClick={() => setImportResult(null)} aria-label="关闭">✕</button></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><Count label="CREATED" value={Number((importResult.result as Record<string, unknown> | undefined)?.created || 0)} /><Count label="UPDATED" value={Number((importResult.result as Record<string, unknown> | undefined)?.updated || 0)} /><Count label="SKIPPED_ALREADY_APPROVED" value={Number((importResult.result as Record<string, unknown> | undefined)?.skippedAlreadyApproved || 0)} /><Count label="UNCHANGED" value={Number((importResult.result as Record<string, unknown> | undefined)?.unchanged || 0)} /><Count label="BLOCKED" value={Number((importResult.result as Record<string, unknown> | undefined)?.blocked || 0)} /><Count label="FAILED" value={Number((importResult.result as Record<string, unknown> | undefined)?.failed || 0)} /></div><details className="mt-3"><summary className="cursor-pointer text-xs text-slate-600">展开逐类型结果</summary><pre className="mt-2 max-h-52 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(importResult, null, 2)}</pre></details></div>}
    </main>
  )
}

function Count({ label, value }: { label: string; value: number }) { return <div className="rounded-md bg-slate-50 px-1 py-2"><div className="font-bold text-slate-900">{value}</div><div className="mt-0.5 text-slate-500">{label}</div></div> }

function SummaryTable({ title, summary }: { title: string; summary: PackPreview['summary']['content'] }) {
  const values = [['NEW', summary.new], ['UPDATE AVAILABLE', summary.updateAvailable], ['APPROVED SKIPPED', summary.approvedSkipped], ['UNCHANGED', summary.unchanged], ['BLOCKED', summary.blocked], ['TOTAL', summary.total]] as const
  return <div className="rounded-lg border border-slate-200 bg-white p-3"><h3 className="text-sm font-bold">{title}</h3><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">{values.map(([label, value]) => <div key={label} className="flex justify-between gap-2"><span className="text-slate-500">{label}</span><strong className="text-slate-900">{value}</strong></div>)}</div></div>
}

function JyutpingCounters({ stats }: { stats: NonNullable<Pack['jyutping']> }) {
  return <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-5"><Count label="需发音内容" value={stats.needsPronunciation} /><Count label="粤拼候选" value={stats.candidates} /><Count label="待人工核对" value={stats.reviewRequired} /><Count label="缺候选" value={stats.missing} /><Count label="已确认" value={stats.verified} /></div>
}

function PreviewHeader({ line }: { line: PreviewLine }) {
  const state = line.current?.status === 'APPROVED' && line.decision === 'SKIPPED_ALREADY_APPROVED' ? 'APPROVED_PROTECTED' : line.decision
  return <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-all font-mono text-xs text-slate-500">{line.id}</p></div><span className={`shrink-0 rounded border px-2 py-1 text-[11px] font-bold ${decisionClasses[line.decision] || 'border-slate-200 bg-slate-50 text-slate-700'}`}>{decisionLabels[state] || decisionLabels[line.decision] || state}</span></div>
}

function DiffView({ line }: { line: PreviewLine }) {
  if (!line.diff.length) return null
  return <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/70 p-3"><h4 className="text-xs font-bold text-amber-950">生产版本 vs 候选版本</h4><div className="mt-2 space-y-2">{line.diff.map((entry) => <div key={entry.field} className="grid gap-1 border-t border-amber-100 pt-2 text-xs sm:grid-cols-[120px_1fr_1fr]"><strong>{fieldLabels[entry.field] || entry.field}</strong><p><span className="text-slate-500">当前：</span>{entry.old || '—'}</p><p><span className="text-slate-500">候选：</span>{entry.next || '—'}</p></div>)}</div></div>
}

function PreviewContentRow({ line, onAdopt, busy }: { line: PreviewLine; onAdopt: () => void; busy: boolean }) {
  const candidate = line.candidate
  const jpt = text(candidate.jyutping, '')
  const jptStatus = !jpt ? '缺失' : candidate.jyutpingReviewStatus === 'VERIFIED' ? '已确认' : '待人工核对'
  return <details className="rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer list-none"><PreviewHeader line={line} /><p className="mt-2 font-semibold text-slate-900">{text(candidate.displayText, text(candidate.title))}</p><p className="mt-1 text-sm text-slate-600">{text(candidate.jyutping, '粤拼待人工填写')} <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${jptStatus === '已确认' ? 'bg-emerald-50 text-emerald-800' : jptStatus === '缺失' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>{jptStatus}</span></p></summary>
    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><Field label="类型" value={text(candidate.contentType)} /><Field label="中文意思" value={text(candidate.translation)} /><Field label="用法说明" value={text(candidate.usageNote)} /><Field label="课程小节" value={text(candidate.section)} /><Field label="需要标准音频" value={pretty(candidate.requiresAudio)} /><Field label="启用跟读" value={pretty(candidate.requiresSpeaking)} /><Field label="标准音状态" value={candidate.audioReady === true ? 'READY + APPROVED' : `${text(candidate.audioAssetStatus, 'NOT_GENERATED')} / ${text(candidate.audioReviewStatus, '未审核')}`} /><Field label="当前生产状态" value={line.current?.status || '不存在'} /><Field label="候选操作" value={line.current?.status === 'APPROVED' ? '已批准 — 普通导入将跳过' : line.decision} /></div>
    {line.current?.status === 'APPROVED' && line.decision === 'UPDATE_AVAILABLE' && <p className="mt-3 text-sm font-semibold text-amber-900">有新版候选；普通导入不会覆盖已批准内容。</p>}
    <DiffView line={line} />
    <div className="mt-3 flex flex-wrap gap-2">{line.current?.status === 'APPROVED' && line.decision === 'UPDATE_AVAILABLE' && <button disabled={busy} onClick={onAdopt} className="rounded-md border border-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 disabled:opacity-50">查看并采纳新版</button>}</div>
  </details>
}

function PreviewQuestionRow({ line, onAdopt, busy }: { line: PreviewLine; onAdopt: () => void; busy: boolean }) {
  const candidate = line.candidate
  const audioNeeded = candidate.questionType === 'LISTENING' || candidate.questionType === 'SPEAKING'
  return <details className="rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer list-none"><PreviewHeader line={line} /><p className="mt-2 font-semibold text-slate-900">{text(candidate.prompt)}</p><p className="mt-1 text-xs text-slate-500">{text(candidate.questionType)}{candidate.questionType === 'MULTI_SELECT' ? ' · 多选' : ''}</p></summary>
    <div className="mt-3 space-y-2 text-sm"><div><strong>选项</strong><ol className="mt-1 list-decimal pl-5">{optionsWithAnswers(candidate).map((option) => <li key={option.id}>{text(option.text)}{option.correct ? <strong className="ml-2 text-emerald-800">正确答案</strong> : null}</li>)}</ol></div><Field label="正确答案 ID" value={pretty(candidate.correctAnswer)} /><Field label="解析" value={text(candidate.explanation)} /><Field label="对应教学内容" value={pretty(candidate.prerequisiteContentIds)} /><Field label="Audio reference" value={text(candidate.audioId)} /><Field label="当前审核状态" value={line.current?.status || '不存在'} />{line.current?.status === 'APPROVED' && line.decision === 'UPDATE_AVAILABLE' && <p className="font-semibold text-amber-900">已批准 — 普通导入将跳过；有新版候选。</p>}{candidate.questionType === 'SPEAKING' && <p className="rounded bg-slate-50 p-2 font-semibold">口语练习：不评分。</p>}{audioNeeded && <p className={`rounded p-2 ${candidate.audioReady === true ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>{candidate.audioReady === true ? '标准音已审核并就绪。' : '标准音尚未就绪，暂不可批准。'}</p>}</div><DiffView line={line} />{line.current?.status === 'APPROVED' && line.decision === 'UPDATE_AVAILABLE' && <button disabled={busy} onClick={onAdopt} className="mt-3 rounded-md border border-amber-500 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">查看并采纳新版</button>}
  </details>
}

function PreviewAudioRow({ line, onAdopt, busy }: { line: PreviewLine; onAdopt: () => void; busy: boolean }) {
  const candidate = line.candidate
  return <details className="rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer list-none"><PreviewHeader line={line} /><p className="mt-2 font-semibold text-slate-900">{text(candidate.text)}</p><p className="mt-1 text-sm text-slate-600">{text(candidate.jyutping, '粤拼缺失')} · {text(candidate.assetStatus, 'NOT_GENERATED')}</p></summary>
    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><Field label="来源内容" value={text(candidate.contentId)} /><Field label="粤拼状态" value={text(candidate.jyutpingReviewStatus)} /><Field label="候选音频资产状态" value={text(candidate.assetStatus, 'NOT_GENERATED')} /><Field label="生产音频资产状态" value={text(line.current?.assetStatus, '无现存资产')} /><Field label="当前审核状态" value={line.current?.status || '不存在'} /></div><p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">标准音未生成；粤拼需先人工核对。当前不能生成 TTS 或批准。</p>{line.current?.status === 'APPROVED' && line.decision === 'UPDATE_AVAILABLE' && <button disabled={busy} onClick={onAdopt} className="mt-3 rounded-md border border-amber-500 px-3 py-1.5 text-xs font-semibold">查看并采纳新版</button>}<DiffView line={line} />
  </details>
}

function Field({ label, value }: { label: string; value: string }) { return <p className="break-words"><strong className="text-slate-700">{label}：</strong><span className="text-slate-600">{value}</span></p> }

function ReviewCard({ tab, item, detail, detailLoading, detailError, expanded, busy, onToggle, onAction, onEdit, onEditTeaching }: { tab: Tab; item: ReviewItem; detail?: ReviewDetail; detailLoading: boolean; detailError?: string; expanded: boolean; busy: boolean; onToggle: () => void; onAction: (action: string) => void; onEdit: () => void; onEditTeaching: (sourceId: string) => void }) {
  const currentItem = detail?.item || item
  const display = tab === 'teaching' ? text(currentItem.displayText, text(currentItem.title)) : tab === 'question' ? text(currentItem.prompt) : text(currentItem.text)
  const needsJpt = tab === 'audio' || (tab === 'teaching' && (currentItem.requiresAudio === true || currentItem.requiresSpeaking === true))
  const jyutpingState = text(currentItem.jyutpingReviewStatus, currentItem.jyutping ? 'JYUTPING_REVIEW_REQUIRED' : 'MISSING')
  const audioReady = currentItem.audioReady === false || currentItem.serverSupported === false ? false : currentItem.audioReady === true || currentItem.assetStatus === 'READY' && currentItem.status === 'APPROVED'
  const jyutpingSourceId = tab === 'audio' && typeof currentItem.jyutpingSourceId === 'string' ? currentItem.jyutpingSourceId.trim() : ''
  const linkedAudio = Boolean(jyutpingSourceId)
  const pronunciationSyncBlocked = tab === 'audio' && (currentItem.pronunciationSnapshotMatches === false || currentItem.pronunciationSourceValid === false)
  const approvalBlocked = (needsJpt && jyutpingState !== 'VERIFIED') || (tab === 'audio' && (currentItem.assetStatus !== 'READY' || !audioReady || pronunciationSyncBlocked)) || ((currentItem.requiresAudio === true || currentItem.questionType === 'LISTENING' || currentItem.questionType === 'SPEAKING') && !audioReady)
  const options = Array.isArray(currentItem.options) ? currentItem.options as Array<{ id?: string; text?: string }> : []
  const answers = Array.isArray(currentItem.correctAnswer) ? currentItem.correctAnswer.map(String) : []
  return <article className="rounded-lg border border-slate-200 bg-white p-3"><button onClick={onToggle} className="block w-full text-left"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{display}</p><span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]">{currentItem.status}</span></div><p className="mt-1 break-all font-mono text-[11px] text-slate-500">{currentItem.externalId} · {text(currentItem.lessonId)}</p></button>
    {expanded && <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
      {tab === 'teaching' && <div className="grid gap-2 sm:grid-cols-2"><Field label="粤拼" value={text(currentItem.jyutping, '缺失')} /><Field label="解释" value={text(currentItem.translation, text(currentItem.explanation))} /><Field label="类型 / 小节" value={`${text(currentItem.contentType)} / ${text(currentItem.section)}`} /><Field label="跟读 / 音频" value={`${pretty(currentItem.requiresSpeaking)} / ${pretty(currentItem.requiresAudio)}`} /></div>}
      {tab === 'question' && <div className="space-y-2"><Field label="题型" value={text(currentItem.questionType)} />{currentItem.questionType === 'MULTI_SELECT' && <strong>（多选）</strong>}<ol className="list-decimal pl-5">{options.map((option) => <li key={option.id}>{text(option.text)}{option.id && answers.includes(option.id) ? <strong className="ml-2 text-emerald-800">正确</strong> : null}</li>)}</ol><Field label="解析" value={text(currentItem.explanation)} /><Field label="前置教学" value={pretty(currentItem.prerequisiteContentIds)} /><Field label="Audio reference" value={text(currentItem.audioId)} />{currentItem.questionType === 'SPEAKING' && <p className="rounded bg-slate-50 p-2">口语题不评分。</p>}</div>}
      {tab === 'audio' && <div className="grid gap-2 sm:grid-cols-2"><Field label="音频状态" value={text(currentItem.assetStatus)} /><Field label="粤拼" value={text(currentItem.jyutping, '缺失')} /><Field label="来源内容" value={text(currentItem.contentId)} /><Field label="COS 状态" value={currentItem.serverSupported === true ? 'READY' : '未就绪'} /><audio controls preload="none" className="mt-2 w-full sm:col-span-2" src={`/api/admin/cantonese/review/audio/${encodeURIComponent(currentItem.externalId)}/preview`} /></div>}
      {linkedAudio && <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900">粤拼审核来源：关联教学内容 {jyutpingSourceId}。教学内容的确认已作为音频依据，音频无需再次确认。</p>}
      {needsJpt && <div className={`mt-3 rounded-md px-3 py-2 text-xs font-semibold ${jyutpingState === 'VERIFIED' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>粤拼状态：{jyutpingState === 'VERIFIED' ? '已确认' : jyutpingState === 'MISSING' ? '缺失' : '待人工核对'}</div>}
      {approvalBlocked && currentItem.status !== 'APPROVED' && <p className="mt-2 text-xs font-semibold text-rose-800">{pronunciationSyncBlocked ? '音频与当前教学内容粤拼不同步，请重新生成后再审核。' : needsJpt && jyutpingState !== 'VERIFIED' ? linkedAudio ? '请先在关联教学内容确认粤拼，当前不能通过。' : '请先确认粤拼，当前不能通过。' : '标准音尚未就绪，当前不能通过。'}</p>}
      {detailLoading && <p className="mt-3 text-xs text-slate-500">正在加载正式审核记录…</p>}
      {detailError && <p role="alert" className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{detailError}</p>}
      {detail && <ReviewLogList logs={detail.logs} />}
      <div className="mt-3 flex flex-wrap gap-2">
        {needsJpt && !linkedAudio && Boolean(currentItem.jyutping) && <button disabled={busy} onClick={() => onAction(jyutpingState === 'VERIFIED' ? 'revoke-jyutping' : 'verify-jyutping')} className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">{jyutpingState === 'VERIFIED' ? '撤销粤拼确认' : '确认粤拼'}</button>}
        {linkedAudio && <button disabled={busy} onClick={() => onEditTeaching(jyutpingSourceId)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold">编辑来源教学内容</button>}
        {tab === 'teaching' && <button disabled={busy} onClick={onEdit} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold">编辑</button>}
        {tab === 'audio' && <button disabled={busy || jyutpingState !== 'VERIFIED'} onClick={() => onAction('generate-audio')} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">生成标准音频</button>}
        <button disabled={busy || approvalBlocked || currentItem.status === 'APPROVED'} onClick={() => onAction('approve')} className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">通过</button>
        <button disabled={busy || currentItem.status === 'REJECTED'} onClick={() => onAction('reject')} className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-800 disabled:opacity-40">退回</button>
      </div>
    </div>}
  </article>
}

function ReviewLogList({ logs }: { logs: ReviewLog[] }) {
  return <section className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3"><h4 className="text-xs font-bold uppercase tracking-wide text-slate-700">正式审核记录</h4>{logs.length === 0 ? <p className="mt-2 text-xs text-slate-500">暂无正式审核记录。</p> : <ol className="mt-2 space-y-2">{logs.map((log, index) => { const reviewer = log.reviewer?.nickname?.trim() || '未知审核人'; const action = reviewLogAction(log); return <li key={log.id || `${action}-${log.createdAt || index}`} className="border-t border-slate-200 pt-2 text-xs text-slate-600 first:border-t-0 first:pt-0"><p><strong className="text-slate-800">{action}</strong><span className="mx-1">·</span>{reviewer}<span className="mx-1">·</span><time dateTime={log.createdAt || undefined}>{reviewLogDate(log.createdAt)}</time></p><p className="mt-1">最终粤拼：<strong className="text-slate-800">{reviewLogJyutpingDisplay(log)}</strong></p></li> })}</ol>}</section>
}

function ConfirmDialog({ title, children, onCancel, onConfirm, busy, confirmLabel }: { title: string; children: React.ReactNode; onCancel: () => void; onConfirm: () => void; busy: boolean; confirmLabel: string }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl"><h3 className="text-lg font-bold text-slate-950">{title}</h3><div className="mt-3 text-sm leading-6 text-slate-700">{children}</div><div className="mt-5 flex justify-end gap-2"><button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-2 text-sm">取消</button><button disabled={busy} onClick={onConfirm} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? '处理中…' : confirmLabel}</button></div></div></div>
}
