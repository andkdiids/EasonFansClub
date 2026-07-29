'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

type Difficulty = 'EASY' | 'ADVANCED' | 'HARD'
type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
type Variant = { id: string; durationSeconds: number; storagePath: string; fileSize: number }
type MusicSong = {
  id: string
  title: string
  artist: string
  trackNumber: number
  releaseYear: number
  coverUrl: string | null
  previewUrl: string | null
  sourceAudioRevision: string | null
  hasAudioSource: boolean
  hasGuessClip: boolean
  album: {
    id: string
    name: string
    artist: string
    releaseYear: number
    coverUrl: string | null
  }
}
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
  audioSourceType: string | null
  musicSourceRevision: string | null
  sourceStale?: boolean
  audioDurationMs: number | null
  processingStatus: ProcessingStatus
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
type UploadStage = 'uploading' | 'converting' | 'generating' | 'cos'

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
const difficultyLabels: Record<Difficulty, string> = {
  EASY: '简单',
  ADVANCED: '进阶',
  HARD: '困难',
}
const processingLabels: Record<ProcessingStatus, string> = {
  PENDING: '等待上传音频',
  PROCESSING: '正在处理音频',
  READY: '音频已就绪',
  FAILED: '音频处理失败',
}
const uploadStageLabels: Record<UploadStage, string> = {
  uploading: '正在上传',
  converting: '正在转换格式',
  generating: '正在生成 2～7 秒片段',
  cos: '正在上传腾讯云 COS',
}
const requiredDuration: Record<Difficulty, number> = { EASY: 7, ADVANCED: 4, HARD: 2 }
const acceptedAudioTypes = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/x-aac',
])
const maxFileSize = 100 * 1024 * 1024

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    data?: T
    error?: string
  } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) {
    throw new Error(payload?.error || '操作失败')
  }
  return payload.data
}

function questionToForm(question: Question, enabled = question.enabled): FormState {
  return {
    songTitle: question.songTitle,
    albumTitle: question.albumTitle || '',
    musicSongId: question.musicSongId || '',
    difficulty: question.difficulty,
    allowEndless: question.allowEndless,
    correctAnswer: question.correctAnswer,
    wrongOption1: question.wrongOption1,
    wrongOption2: question.wrongOption2,
    wrongOption3: question.wrongOption3,
    enabled,
  }
}

function getEnableBlockReason(question: Question) {
  if (question.processingStatus === 'PROCESSING') return '音频仍在处理中'
  if (question.processingStatus === 'FAILED') return '音频处理失败，请重新上传'
  if (question.processingStatus !== 'READY') return '请先上传至少 7 秒的音频'
  const available = new Set(question.audioVariants.map((variant) => variant.durationSeconds))
  const required = question.allowEndless
    ? [2, 3, 4, 5, 6, 7]
    : [requiredDuration[question.difficulty]]
  const missing = required.filter((duration) => !available.has(duration))
  return missing.length > 0 ? `缺少 ${missing.join('、')} 秒音频变体` : ''
}

function safeProcessingError(value: string | null) {
  if (!value) return ''
  if (/https?:\/\/|secret|signature|credential|[a-z]:[\\/]|\/(?:tmp|var|home)\//i.test(value)) {
    return '音频处理失败，请检查文件格式和时长后重新上传。'
  }
  return value.slice(0, 240)
}

function inspectAudioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    const finish = () => {
      audio.removeAttribute('src')
      audio.load()
      URL.revokeObjectURL(url)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const duration = audio.duration
      finish()
      if (!Number.isFinite(duration)) reject(new Error('无法读取音频时长'))
      else resolve(duration)
    }
    audio.onerror = () => {
      finish()
      reject(new Error('无法读取音频，请确认文件格式有效'))
    }
    audio.src = url
  })
}

export function AdminGuessSongManager() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [musicSongs, setMusicSongs] = useState<MusicSong[]>([])
  const [sourceMode, setSourceMode] = useState<'EASMUSIC_SONG' | 'MANUAL_UPLOAD'>('EASMUSIC_SONG')
  const [songQuery, setSongQuery] = useState('')
  const [songYear, setSongYear] = useState('')
  const [songAlbum, setSongAlbum] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null)
  const [fileError, setFileError] = useState('')
  const [query, setQuery] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [enabledFilter, setEnabledFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null)
  const [playingKey, setPlayingKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const uploadRegionRef = useRef<HTMLDivElement | null>(null)
  const selectedMusicSong = musicSongs.find((song) => song.id === form.musicSongId) || null
  const filteredMusicSongs = musicSongs.filter((song) => {
    const keyword = songQuery.trim().toLocaleLowerCase('zh-CN')
    const matchesKeyword = !keyword || [
      song.title,
      song.artist,
      song.album.name,
      song.album.artist,
    ].some((value) => value.toLocaleLowerCase('zh-CN').includes(keyword))
    return matchesKeyword
      && (!songYear || String(song.releaseYear) === songYear)
      && (!songAlbum || song.album.id === songAlbum)
  })
  const songYears = [...new Set(musicSongs.map((song) => song.releaseYear))].sort((a, b) => b - a)
  const songAlbums = [...new Map(musicSongs.map((song) => [song.album.id, song.album])).values()]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, difficulty, enabled: enabledFilter })
      const data = await api<{ questions: Question[]; musicSongs: MusicSong[] }>(
        `/api/admin/entertainment/guess-song/questions?${params}`,
      )
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

  useEffect(() => {
    if (!activeUploadId) return
    window.requestAnimationFrame(() => {
      uploadRegionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [activeUploadId])

  useEffect(() => {
    if (!uploadStage) return
    const stages: UploadStage[] = ['uploading', 'converting', 'generating', 'cos']
    let index = 0
    const timer = window.setInterval(() => {
      index = Math.min(index + 1, stages.length - 1)
      setUploadStage(stages[index])
    }, 1400)
    return () => window.clearInterval(timer)
  }, [uploadStage])

  function stopPreview() {
    previewAudioRef.current?.pause()
    previewAudioRef.current = null
    setPlayingKey('')
  }

  function edit(question: Question) {
    setEditingId(question.id)
    setForm(questionToForm(question))
    setSourceMode(question.audioSourceType === 'MANUAL_UPLOAD' || !question.musicSongId
      ? 'MANUAL_UPLOAD'
      : 'EASMUSIC_SONG')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function reset() {
    setEditingId(null)
    setForm(emptyForm)
    setSourceMode('EASMUSIC_SONG')
  }

  function selectMusicSong(song: MusicSong) {
    if (!song.hasAudioSource) return
    setForm((current) => ({
      ...current,
      musicSongId: song.id,
      songTitle: current.songTitle.trim() ? current.songTitle : song.title,
      correctAnswer: current.correctAnswer.trim() ? current.correctAnswer : song.title,
      albumTitle: current.albumTitle.trim() ? current.albumTitle : song.album.name,
    }))
  }

  function openUpload(question: Question) {
    stopPreview()
    setActiveUploadId(question.id)
    setSelectedFile(null)
    setSelectedDuration(null)
    setFileError('')
    setError('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    if (sourceMode === 'EASMUSIC_SONG' && !form.musicSongId) {
      setError('请先从 EasMusic 歌曲库选择拥有音频源的歌曲')
      return
    }
    const wasEditing = Boolean(editingId)
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
      setQuestions((current) => wasEditing
        ? current.map((question) => question.id === data.question.id ? data.question : question)
        : [data.question, ...current])
      if (wasEditing) {
        setMessage('题目已保存')
        reset()
      } else {
        setEditingId(null)
        setForm(emptyForm)
        setActiveUploadId(sourceMode === 'MANUAL_UPLOAD' ? data.question.id : null)
        setSelectedFile(null)
        setSelectedDuration(null)
        setFileError('')
        setMessage(sourceMode === 'EASMUSIC_SONG'
          ? '题目已创建，请在题目卡片点击“生成猜歌片段”'
          : '题目已创建，请上传音频并生成猜歌片段')
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function chooseFile(file: File | null) {
    setSelectedFile(null)
    setSelectedDuration(null)
    setFileError('')
    if (!file) return
    const extensionAllowed = /\.(mp3|m4a|wav|aac)$/i.test(file.name)
    if (!acceptedAudioTypes.has(file.type) && !extensionAllowed) {
      setFileError('仅支持 MP3、M4A、WAV、AAC')
      return
    }
    if (file.size > maxFileSize) {
      setFileError('音频文件不能超过 20MB')
      return
    }
    try {
      const duration = await inspectAudioDuration(file)
      if (duration < 7) {
        setFileError(`音频时长 ${duration.toFixed(1)} 秒，必须至少 7 秒`)
        return
      }
      setSelectedFile(file)
      setSelectedDuration(duration)
    } catch (requestError) {
      setFileError(requestError instanceof Error ? requestError.message : '无法读取音频')
    }
  }

  async function uploadAudio(question: Question) {
    if (!selectedFile || busyId) return
    setBusyId(question.id)
    setUploadStage('uploading')
    setError('')
    setMessage('')
    try {
      const formData = new FormData()
      formData.set('file', selectedFile)
      const data = await api<{ question: Question }>(
        `/api/admin/entertainment/guess-song/questions/${question.id}/audio`,
        { method: 'POST', body: formData },
      )
      setQuestions((current) => current.map((item) =>
        item.id === question.id ? data.question : item))
      setSelectedFile(null)
      setSelectedDuration(null)
      setMessage('音频片段已生成并上传至腾讯云 COS，请试听确认后启用题目。')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '音频处理失败')
      await load()
    } finally {
      setUploadStage(null)
      setBusyId(null)
    }
  }

  async function regenerate(question: Question) {
    if (!window.confirm('确认使用现有音频源重新生成全部 2～7 秒变体吗？')) return
    setBusyId(question.id)
    setUploadStage('converting')
    setError('')
    try {
      const data = await api<{ question: Question }>(
        `/api/admin/entertainment/guess-song/questions/${question.id}/regenerate`,
        { method: 'POST' },
      )
      setQuestions((current) => current.map((item) =>
        item.id === question.id ? data.question : item))
      setMessage('音频变体已重新生成，题目已自动停用，请试听后再启用。')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '重新生成失败')
      await load()
    } finally {
      setUploadStage(null)
      setBusyId(null)
    }
  }

  async function generateFromMusic(question: Question) {
    if (!question.musicSongId || busyId) return
    setBusyId(question.id)
    setUploadStage('converting')
    setError('')
    setMessage('')
    try {
      const data = await api<{ question: Question }>(
        `/api/admin/entertainment/guess-song/questions/${question.id}/from-music`,
        { method: 'POST' },
      )
      setQuestions((current) => current.map((item) =>
        item.id === question.id ? data.question : item))
      setMessage('已从 EasMusic 私有音频源生成独立的 2～7 秒猜歌片段，请试听确认。')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '猜歌片段生成失败')
      await load()
    } finally {
      setUploadStage(null)
      setBusyId(null)
    }
  }

  async function preview(question: Question, durationSeconds: number) {
    const key = `${question.id}:${durationSeconds}`
    if (playingKey === key) {
      stopPreview()
      return
    }
    stopPreview()
    setError('')
    try {
      const data = await api<{ signedUrl: string }>(
        `/api/admin/entertainment/guess-song/questions/${question.id}/preview?duration=${durationSeconds}`,
      )
      const audio = new Audio(data.signedUrl)
      audio.onended = stopPreview
      audio.onerror = () => {
        stopPreview()
        setError('试听地址已失效或音频无法播放，请重新点击试听。')
      }
      previewAudioRef.current = audio
      setPlayingKey(key)
      await audio.play()
    } catch (requestError) {
      stopPreview()
      setError(requestError instanceof Error ? requestError.message : '试听失败')
    }
  }

  async function toggleEnabled(question: Question) {
    const enabling = !question.enabled
    const reason = enabling ? getEnableBlockReason(question) : ''
    if (reason) return
    setBusyId(question.id)
    setError('')
    try {
      const data = await api<{ question: Question }>(
        `/api/admin/entertainment/guess-song/questions/${question.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(questionToForm(question, enabling)),
        },
      )
      setQuestions((current) => current.map((item) =>
        item.id === question.id ? data.question : item))
      setMessage(enabling ? '题目已启用' : '题目已停用')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '状态修改失败')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(question: Question) {
    if (!window.confirm(`确认删除题目《${question.songTitle}》吗？`)) return
    if (!window.confirm('删除后将同时清理私有音频文件。请再次确认。')) return
    setBusyId(question.id)
    try {
      await api(`/api/admin/entertainment/guess-song/questions/${question.id}`, {
        method: 'DELETE',
      })
      if (activeUploadId === question.id) setActiveUploadId(null)
      setQuestions((current) => current.filter((item) => item.id !== question.id))
      setMessage('题目已删除')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '删除失败')
    } finally {
      setBusyId(null)
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
        <span>先创建题目资料，再上传至少 7 秒的音频；服务端会生成私有的 2～7 秒 MP3 变体。</span>
      </header>
      {message ? <p className="guess-song-admin-message" role="status">{message}</p> : null}
      {error ? <p className="guess-song-error" role="alert">{error}</p> : null}

      <form onSubmit={save} className="guess-song-admin-form">
        <div className="guess-song-admin-form-heading">
          <div>
            <small>第一步</small>
            <h2>{editingId ? '编辑题目' : '创建题目资料'}</h2>
          </div>
          {editingId ? <button type="button" onClick={reset}>取消编辑</button> : null}
        </div>
        <div className="guess-song-admin-form-grid">
          {field('songTitle', '歌曲名称')}
          {field('albumTitle', '专辑名称（可选）', false)}
          <label>
            <span>难度</span>
            <select
              value={form.difficulty}
              onChange={(event) => setForm({
                ...form,
                difficulty: event.target.value as Difficulty,
              })}
            >
              {Object.entries(difficultyLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {field('correctAnswer', '正确答案')}
          {field('wrongOption1', '错误选项一')}
          {field('wrongOption2', '错误选项二')}
          {field('wrongOption3', '错误选项三')}
        </div>
        <fieldset className="guess-song-source-picker">
          <legend>音频来源</legend>
          <div className="guess-song-source-tabs">
            <label>
              <input
                type="radio"
                checked={sourceMode === 'EASMUSIC_SONG'}
                onChange={() => setSourceMode('EASMUSIC_SONG')}
              />
              从 EasMusic 歌曲库选择
            </label>
            <label>
              <input
                type="radio"
                checked={sourceMode === 'MANUAL_UPLOAD'}
                onChange={() => {
                  setSourceMode('MANUAL_UPLOAD')
                  setForm((current) => ({ ...current, musicSongId: '' }))
                }}
              />
              手动上传音频
            </label>
          </div>
          {sourceMode === 'EASMUSIC_SONG' ? (
            <>
              <div className="guess-song-library-filters">
                <input
                  aria-label="搜索歌曲、专辑或歌手"
                  placeholder="搜索歌曲、专辑或歌手"
                  value={songQuery}
                  onChange={(event) => setSongQuery(event.target.value)}
                />
                <select value={songYear} onChange={(event) => setSongYear(event.target.value)}>
                  <option value="">全部年份</option>
                  {songYears.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
                <select value={songAlbum} onChange={(event) => setSongAlbum(event.target.value)}>
                  <option value="">全部专辑</option>
                  {songAlbums.map((album) => (
                    <option key={album.id} value={album.id}>{album.name}</option>
                  ))}
                </select>
              </div>
              <div className="guess-song-library-list">
                {filteredMusicSongs.slice(0, 100).map((song) => (
                  <article key={song.id} aria-current={form.musicSongId === song.id}>
                    <span className="guess-song-library-cover relative">
                      {song.coverUrl || song.album.coverUrl
                        ? <Image src={song.coverUrl || song.album.coverUrl || ''} alt="" fill sizes="48px" className="object-cover" />
                        : '♪'}
                    </span>
                    <div>
                      <strong>{String(song.trackNumber).padStart(2, '0')} · {song.title}</strong>
                      <span>{song.album.name} · {song.artist} · {song.releaseYear}</span>
                      <small>
                        {song.hasAudioSource ? '已有音频源' : '尚未上传音频'}
                        {' · '}{song.previewUrl ? '已有 60 秒试听' : '暂无试听'}
                        {' · '}{song.hasGuessClip ? '已有猜歌题目' : '未生成猜歌片段'}
                      </small>
                    </div>
                    {song.hasAudioSource ? (
                      <button type="button" onClick={() => selectMusicSong(song)}>
                        {form.musicSongId === song.id ? '已选择' : '选择'}
                      </button>
                    ) : (
                      <Link href={`/admin/music/albums/${song.album.id}`}>编辑歌曲</Link>
                    )}
                  </article>
                ))}
              </div>
              {selectedMusicSong ? (
                <p className="guess-song-selected-source">
                  已选择《{selectedMusicSong.title}》；保存题目后可从私有音频源生成最长 7 秒片段。
                </p>
              ) : null}
            </>
          ) : (
            <p className="guess-song-selected-source">
              保留旧题目与特殊 Live 音频的手动上传方式；题目保存后再上传文件。
            </p>
          )}
        </fieldset>
        <div className="guess-song-admin-checks">
          <label>
            <input
              type="checkbox"
              checked={form.allowEndless}
              onChange={(event) => setForm({ ...form, allowEndless: event.target.checked })}
            />
            允许进入无尽模式
          </label>
        </div>
        <button className="guess-song-admin-primary" disabled={saving}>
          {saving ? '保存中…' : editingId ? '保存修改' : '创建题目'}
        </button>
      </form>

      <section className="guess-song-admin-list">
        <div className="guess-song-admin-filters">
          <input
            aria-label="搜索歌曲名称"
            placeholder="搜索歌曲名称"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="按难度筛选"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            <option value="">全部难度</option>
            {Object.entries(difficultyLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="按启用状态筛选"
            value={enabledFilter}
            onChange={(event) => setEnabledFilter(event.target.value)}
          >
            <option value="">全部状态</option>
            <option value="true">已启用</option>
            <option value="false">已停用</option>
          </select>
        </div>
        {loading ? <p className="guess-song-empty">正在加载题库…</p> : null}
        {!loading && questions.length === 0 ? (
          <div className="guess-song-empty">
            <p>暂无符合条件的题目。</p>
            <p>先在上方创建题目，创建后即可上传音频。</p>
          </div>
        ) : null}
        {questions.map((question) => {
          const correctRate = question.answerCount > 0
            ? Math.round(question.correctCount / question.answerCount * 100)
            : 0
          const enableBlockReason = getEnableBlockReason(question)
          const active = activeUploadId === question.id
          const busy = busyId === question.id
          const linkedSong = musicSongs.find((song) => song.id === question.musicSongId)
          return (
            <article key={question.id}>
              <div className="guess-song-admin-question-main">
                <div>
                  <span>{difficultyLabels[question.difficulty]}</span>
                  <span>{processingLabels[question.processingStatus]}</span>
                  <span>{question.enabled ? '已启用' : '已停用'}</span>
                </div>
                <h2>《{question.songTitle}》</h2>
                <p>正确答案：{question.correctAnswer}</p>
                <small>
                  正确率 {correctRate}% · 作答 {question.answerCount} 次 · 创建于{' '}
                  {new Date(question.createdAt).toLocaleString('zh-CN')}
                </small>
                {question.processingStatus === 'FAILED' && question.processingError ? (
                  <p className="guess-song-admin-processing-error" role="alert">
                    {safeProcessingError(question.processingError)}
                  </p>
                ) : null}
                {question.sourceStale ? (
                  <p className="guess-song-admin-processing-error">
                    歌曲音频已更新，当前猜歌片段仍为旧版本，可选择重新生成。
                  </p>
                ) : null}
              </div>

              <div className="guess-song-admin-preview">
                <strong>试听片段</strong>
                <div className="guess-song-admin-variants">
                  {[2, 3, 4, 5, 6, 7].map((duration) => {
                    const exists = question.audioVariants.some((variant) =>
                      variant.durationSeconds === duration)
                    const key = `${question.id}:${duration}`
                    return (
                      <button
                        key={duration}
                        type="button"
                        disabled={!exists || question.processingStatus !== 'READY'}
                        aria-pressed={playingKey === key}
                        onClick={() => void preview(question, duration)}
                      >
                        {playingKey === key ? `停止 ${duration} 秒` : `${duration} 秒`}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="guess-song-admin-actions">
                {question.musicSongId ? (
                  <button
                    type="button"
                    disabled={!linkedSong?.hasAudioSource || busy}
                    title={!linkedSong?.hasAudioSource ? '关联歌曲尚未上传音频源' : undefined}
                    onClick={() => void generateFromMusic(question)}
                  >
                    {question.audioVariants.length ? '重新生成猜歌片段' : '生成猜歌片段'}
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={() => openUpload(question)}>
                  {question.sourceAudioPath ? '重新上传' : '手动上传'}
                </button>
                <button
                  type="button"
                  disabled={(!question.sourceAudioPath && !question.musicSongId) || busy}
                  title={!question.sourceAudioPath && !question.musicSongId ? '尚无源音频，无法重新生成' : undefined}
                  onClick={() => void regenerate(question)}
                >
                  重新生成
                </button>
                <button type="button" disabled={busy} onClick={() => edit(question)}>编辑</button>
                <button
                  type="button"
                  disabled={busy || (!question.enabled && Boolean(enableBlockReason))}
                  title={!question.enabled && enableBlockReason ? enableBlockReason : undefined}
                  onClick={() => void toggleEnabled(question)}
                >
                  {question.enabled ? '停用' : '启用'}
                </button>
                <button type="button" disabled={busy} onClick={() => void remove(question)}>删除</button>
                {!question.enabled && enableBlockReason ? (
                  <span className="guess-song-admin-disabled-reason">
                    暂不能启用：{enableBlockReason}
                  </span>
                ) : null}
              </div>

              {active ? (
                <div ref={uploadRegionRef} className="guess-song-admin-upload">
                  <div>
                    <small>第二步</small>
                    <h3>{question.sourceAudioPath ? '重新上传音频' : '上传音频'}</h3>
                    <p>支持 MP3、M4A、WAV、AAC，最大 100MB，音频至少 7 秒。</p>
                  </div>
                  <label className="guess-song-admin-file">
                    <span>选择音频文件</span>
                    <input
                      type="file"
                      accept=".mp3,.m4a,.wav,.aac,audio/mpeg,audio/mp4,audio/wav,audio/aac"
                      disabled={busy}
                      onChange={(event) => void chooseFile(event.target.files?.[0] || null)}
                    />
                  </label>
                  {selectedFile ? (
                    <p className="guess-song-admin-file-meta">
                      已选择：{selectedFile.name} · {(selectedFile.size / 1024 / 1024).toFixed(2)}MB
                      {selectedDuration ? ` · ${selectedDuration.toFixed(1)}秒` : ''}
                    </p>
                  ) : null}
                  {fileError ? <p className="guess-song-admin-processing-error">{fileError}</p> : null}
                  {busy && uploadStage ? (
                    <div className="guess-song-admin-progress" role="status" aria-live="polite">
                      <strong>{uploadStageLabels[uploadStage]}</strong>
                      <span>请勿关闭页面</span>
                    </div>
                  ) : null}
                  <div className="guess-song-admin-upload-actions">
                    <button
                      type="button"
                      disabled={!selectedFile || busy}
                      onClick={() => void uploadAudio(question)}
                    >
                      {busy ? '处理中…' : '上传并生成音频片段'}
                    </button>
                    <button
                      type="button"
                      disabled={!selectedFile || busy}
                      onClick={() => {
                        setSelectedFile(null)
                        setSelectedDuration(null)
                        setFileError('')
                      }}
                    >
                      取消选择
                    </button>
                    <button type="button" disabled={busy} onClick={() => setActiveUploadId(null)}>
                      收起
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </section>
    </main>
  )
}
