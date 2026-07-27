'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

type Difficulty = 'EASY' | 'ADVANCED' | 'HARD'
type Variant = { id: string; durationSeconds: number; storagePath: string; fileSize: number }
type MusicSong = { id: string; title: string; album: { name: string } }
type Question = {
  id: string
  songTitle: string
  albumTitle: string | null
  musicSongId: string | null
  difficulty: Difficulty
  enabled: boolean
  allowEndless: boolean
  correctAnswer: string
  wrongOption1: string
  wrongOption2: string
  wrongOption3: string
  sourceAudioPath: string | null
  audioDurationMs: number | null
  processingStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
  processingError: string | null
  playCount: number
  answerCount: number
  correctCount: number
  createdAt: string
  updatedAt: string
  audioVariants: Variant[]
}
type FormState = {
  songTitle: string
  albumTitle: string
  musicSongId: string
  difficulty: Difficulty
  allowEndless: boolean
  correctAnswer: string
  wrongOption1: string
  wrongOption2: string
  wrongOption3: string
  enabled: boolean
}

const emptyForm: FormState = {
  songTitle: '',
  albumTitle: '',
  musicSongId: '',
  difficulty: 'EASY',
  allowEndless: true,
  correctAnswer: '',
  wrongOption1: '',
  wrongOption2: '',
  wrongOption3: '',
  enabled: false,
}
const difficultyLabels: Record<Difficulty, string> = { EASY: '简单', ADVANCED: '进阶', HARD: '困难' }
const processingLabels: Record<Question['processingStatus'], string> = {
  PENDING: '待上传',
  PROCESSING: '处理中',
  READY: '已就绪',
  FAILED: '处理失败',
}

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || !payload.data) throw new Error(payload?.error || '操作失败')
  return payload.data
}

export function AdminGuessSongManager() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [musicSongs, setMusicSongs] = useState<MusicSong[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [enabledFilter, setEnabledFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, difficulty, enabled: enabledFilter })
      const data = await api<{ questions: Question[]; musicSongs: MusicSong[] }>(`/api/admin/entertainment/guess-song/questions?${params}`)
      setQuestions(data.questions)
      setMusicSongs(data.musicSongs)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '题库加载失败')
    } finally {
      setLoading(false)
    }
  }, [difficulty, enabledFilter, query])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => () => {
    previewAudioRef.current?.pause()
    previewAudioRef.current = null
  }, [])

  function edit(question: Question) {
    setEditingId(question.id)
    setForm({
      songTitle: question.songTitle,
      albumTitle: question.albumTitle || '',
      musicSongId: question.musicSongId || '',
      difficulty: question.difficulty,
      allowEndless: question.allowEndless,
      correctAnswer: question.correctAnswer,
      wrongOption1: question.wrongOption1,
      wrongOption2: question.wrongOption2,
      wrongOption3: question.wrongOption3,
      enabled: question.enabled,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function reset() {
    setEditingId(null)
    setForm(emptyForm)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const data = await api<{ question: Question }>(
        editingId
          ? `/api/admin/entertainment/guess-song/questions/${editingId}`
          : '/api/admin/entertainment/guess-song/questions',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      )
      setQuestions((current) => editingId
        ? current.map((question) => question.id === data.question.id ? data.question : question)
        : [data.question, ...current])
      setMessage(editingId ? '题目已保存' : '题目已创建，请继续上传音频')
      reset()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function uploadAudio(question: Question, file: File) {
    setBusyId(question.id)
    setError('')
    setMessage('正在使用 FFmpeg 生成 2 至 7 秒音频变体，请稍候…')
    try {
      const formData = new FormData()
      formData.set('file', file)
      const data = await api<{ question: Question }>(
        `/api/admin/entertainment/guess-song/questions/${question.id}/audio`,
        { method: 'POST', body: formData },
      )
      setQuestions((current) => current.map((item) => item.id === question.id ? data.question : item))
      setMessage('音频处理完成。题目保持停用，请试听确认后手动启用。')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '音频处理失败')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function regenerate(question: Question) {
    if (!window.confirm('确认使用现有短音频源重新生成全部变体吗？')) return
    setBusyId(question.id)
    setError('')
    try {
      const data = await api<{ question: Question }>(
        `/api/admin/entertainment/guess-song/questions/${question.id}/regenerate`,
        { method: 'POST' },
      )
      setQuestions((current) => current.map((item) => item.id === question.id ? data.question : item))
      setMessage('音频变体已重新生成，题目已自动停用，请试听后再启用。')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '重新生成失败')
    } finally {
      setBusyId(null)
    }
  }

  async function preview(question: Question, durationSeconds: number) {
    setError('')
    previewAudioRef.current?.pause()
    try {
      const data = await api<{ signedUrl: string }>(
        `/api/admin/entertainment/guess-song/questions/${question.id}/preview?duration=${durationSeconds}`,
      )
      const audio = new Audio(data.signedUrl)
      previewAudioRef.current = audio
      await audio.play()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '试听失败')
    }
  }

  async function remove(question: Question) {
    if (!window.confirm(`确认删除题目《${question.songTitle}》吗？`)) return
    if (!window.confirm('删除后将同时清理私有音频文件。请再次确认。')) return
    try {
      await api(`/api/admin/entertainment/guess-song/questions/${question.id}`, { method: 'DELETE' })
      setQuestions((current) => current.filter((item) => item.id !== question.id))
      setMessage('题目已删除')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '删除失败')
    }
  }

  const field = (key: keyof FormState, label: string, required = true) => (
    <label>
      <span>{label}</span>
      <input
        required={required}
        maxLength={160}
        value={String(form[key])}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </label>
  )

  return (
    <main className="flat-page guess-song-admin">
      <header>
        <p>Entertainment CMS</p>
        <h1>E声猜歌题库</h1>
        <span>上传短音频源，由服务端生成私有的 2 至 7 秒 MP3 变体。</span>
      </header>
      {message ? <p className="guess-song-admin-message">{message}</p> : null}
      {error ? <p className="guess-song-error" role="alert">{error}</p> : null}
      <form onSubmit={save} className="guess-song-admin-form">
        <div className="guess-song-admin-form-heading">
          <h2>{editingId ? '编辑题目' : '新增题目'}</h2>
          {editingId ? <button type="button" onClick={reset}>取消编辑</button> : null}
        </div>
        <div className="guess-song-admin-form-grid">
          {field('songTitle', '歌曲名称')}
          {field('albumTitle', '专辑名称（可选）', false)}
          <label><span>关联 EasMusic（可选）</span><select value={form.musicSongId} onChange={(event) => setForm({ ...form, musicSongId: event.target.value })}><option value="">不关联</option>{musicSongs.map((song) => <option key={song.id} value={song.id}>{song.title} · {song.album.name}</option>)}</select></label>
          <label><span>难度</span><select value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value as Difficulty })}>{Object.entries(difficultyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {field('correctAnswer', '正确答案')}
          {field('wrongOption1', '错误选项一')}
          {field('wrongOption2', '错误选项二')}
          {field('wrongOption3', '错误选项三')}
        </div>
        <div className="guess-song-admin-checks">
          <label><input type="checkbox" checked={form.allowEndless} onChange={(event) => setForm({ ...form, allowEndless: event.target.checked })} />允许进入无尽模式</label>
          {editingId ? <label><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />启用题目</label> : null}
        </div>
        <button className="guess-song-admin-primary" disabled={saving}>{saving ? '保存中…' : editingId ? '保存修改' : '创建题目'}</button>
      </form>
      <section className="guess-song-admin-list">
        <div className="guess-song-admin-filters">
          <input aria-label="搜索歌曲名称" placeholder="搜索歌曲名称" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="按难度筛选" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="">全部难度</option>{Object.entries(difficultyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="按启用状态筛选" value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value)}><option value="">全部状态</option><option value="true">已启用</option><option value="false">已停用</option></select>
        </div>
        {loading ? <p className="guess-song-empty">正在加载题库…</p> : null}
        {!loading && questions.length === 0 ? <p className="guess-song-empty">暂无符合条件的题目。</p> : null}
        {questions.map((question) => {
          const correctRate = question.answerCount > 0 ? Math.round(question.correctCount / question.answerCount * 100) : 0
          return (
            <article key={question.id}>
              <div className="guess-song-admin-question-main">
                <div>
                  <span>{difficultyLabels[question.difficulty]}</span>
                  <span>{question.enabled ? '已启用' : '已停用'}</span>
                  <span>{processingLabels[question.processingStatus]}</span>
                </div>
                <h2>《{question.songTitle}》</h2>
                <p>正确答案：{question.correctAnswer}</p>
                <small>播放 {question.playCount} · 作答 {question.answerCount} · 正确 {question.correctCount} · 正确率 {correctRate}%</small>
                {question.processingError ? <p className="guess-song-admin-processing-error">{question.processingError}</p> : null}
              </div>
              <div className="guess-song-admin-variants">
                {question.audioVariants.map((variant) => <button key={variant.id} type="button" onClick={() => void preview(question, variant.durationSeconds)}>{variant.durationSeconds}秒试听</button>)}
              </div>
              <div className="guess-song-admin-actions">
                <button type="button" onClick={() => edit(question)}>编辑</button>
                <label className={busyId === question.id ? 'is-disabled' : ''}>上传音频<input type="file" accept=".mp3,.m4a,.wav,.aac,audio/*" disabled={busyId === question.id} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAudio(question, file); event.target.value = '' }} /></label>
                <button type="button" disabled={!question.sourceAudioPath || busyId === question.id} onClick={() => void regenerate(question)}>重新生成</button>
                <button type="button" onClick={() => void remove(question)}>删除</button>
              </div>
            </article>
          )
        })}
      </section>
    </main>
  )
}
