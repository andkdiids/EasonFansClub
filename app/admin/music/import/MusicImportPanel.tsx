'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'

type ImportFailure = { sheet: string; row: number; reason: string }
type ImportResult = {
  committed: boolean
  addedAlbums: number
  addedSongs: number
  skippedAlbums: number
  skippedSongs: number
  failedRows: number
  failures: ImportFailure[]
  ignoredSheets: string[]
}

const albumColumns = 'album_name, artist, release_year, language, cover_url, description, era, album_type'
const songColumns = 'title, album_name, track_number, release_year, language, lyricist, composer, arranger, producer, story, tags, era, track_type, concert_version, mood, scene, recommend_level'

export function MusicImportPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || submitting) return
    setSubmitting(true)
    setResult(null)
    setMessage('')
    setError('')
    try {
      const formData = new FormData()
      formData.set('file', file)
      const response = await fetch('/api/admin/music/import', { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (data?.result) setResult(data.result)
      if (!response.ok) throw new Error(data?.message || '导入失败')
      setMessage(data.message || '导入完成')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
      <section className="rounded-[30px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
        <p className="text-sm font-black tracking-[0.18em] text-brand-700">EasMusic 管理</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">EasMusic 数据导入</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-600">上传 Excel 或 CSV，将专辑和歌曲资料原子化导入数据库。已有数据不会被删除或覆盖。</p>
        <Link href="/admin/music" className="mt-5 inline-flex text-sm font-black text-brand-700">← 返回音乐管理</Link>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[26px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-black text-brand-950">文件格式</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-bold leading-6 text-slate-600">
            <li>支持 `.xlsx` 和 `.csv`，文件最大 10MB。</li>
            <li>Excel 使用 `Albums`、`Songs` 两个 Sheet。</li>
            <li>CSV 根据表头识别类型，一个文件导入一种数据。</li>
            <li>每个数据表最多 5000 条。</li>
          </ul>
          <p className="mt-4 text-xs font-black text-brand-700">Albums 字段</p>
          <p className="mt-2 break-words rounded-2xl bg-sky-50 p-3 text-xs font-bold leading-5 text-slate-600">{albumColumns}</p>
          <p className="mt-4 text-xs font-black text-brand-700">Songs 字段</p>
          <p className="mt-2 break-words rounded-2xl bg-sky-50 p-3 text-xs font-bold leading-5 text-slate-600">{songColumns}</p>
          <p className="mt-4 text-xs font-bold leading-5 text-slate-500">SongTags、SongMemory、ConcertVersion、Achievement Sheet 会被兼容识别，本阶段不写入数据库。</p>
        </div>

        <form onSubmit={submit} className="rounded-[26px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-black text-brand-950">上传导入文件</h2>
          <label className="mt-5 block rounded-[22px] border-2 border-dashed border-sky-200 bg-sky-50/60 p-6 text-center transition hover:border-brand-300">
            <span className="block text-3xl" aria-hidden="true">📊</span>
            <span className="mt-3 block text-sm font-black text-brand-950">选择 Excel 或 CSV</span>
            <span className="mt-1 block truncate text-xs font-bold text-slate-500">{file?.name || '尚未选择文件'}</span>
            <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} className="sr-only" />
          </label>
          <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-xs font-bold leading-5 text-amber-800">导入前会完整校验。无效行、专辑缺失或曲序冲突会让整批数据不写入；重复数据只跳过，不覆盖。</div>
          <button disabled={!file || submitting} className="mt-5 w-full rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{submitting ? '正在校验并导入...' : '开始导入'}</button>
        </form>
      </section>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}

      {result ? (
        <section className={`rounded-[28px] border p-5 shadow-sm sm:p-7 ${result.committed ? 'border-emerald-100 bg-white/90' : 'border-red-100 bg-white/90'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-black text-brand-950">导入结果</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-black ${result.committed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{result.committed ? '事务已提交' : '未写入 / 已回滚'}</span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[['新增专辑', result.addedAlbums], ['新增歌曲', result.addedSongs], ['跳过专辑', result.skippedAlbums], ['跳过歌曲', result.skippedSongs], ['失败', result.failedRows]].map(([label, value]) => <div key={label} className="rounded-2xl bg-sky-50 p-4 text-center"><p className="text-xs font-black text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-brand-950">{value}</p></div>)}
          </div>
          {result.ignoredSheets.length > 0 ? <p className="mt-4 text-xs font-bold text-slate-500">已识别但未导入的辅助 Sheet：{result.ignoredSheets.join('、')}</p> : null}
          {result.failures.length > 0 ? <div className="mt-5"><h3 className="font-black text-red-700">失败原因</h3><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{result.failures.map((failure, index) => <p key={`${failure.sheet}-${failure.row}-${index}`} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold leading-5 text-red-700">{failure.sheet}{failure.row > 0 ? ` 第 ${failure.row} 行` : ''}：{failure.reason}</p>)}</div></div> : null}
        </section>
      ) : null}
    </main>
  )
}
