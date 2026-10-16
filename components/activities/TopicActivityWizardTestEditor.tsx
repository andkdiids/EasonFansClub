'use client'

import { useRef, useState } from 'react'
import type { TopicActivityV2Test, TopicActivityV2TestQuestion, TopicActivityV2TestResult } from '@/lib/topic-activity-v2-config'
import { createWizardId } from './TopicActivityWizardIds'
import { TopicActivityEditorImageUploader } from './TopicActivityPosterBackgroundUploader'

const inputClass = 'mt-1 min-h-10 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm'
const buttonClass = 'min-h-10 rounded-sm border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40'

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function TopicActivityWizardTestEditor({ value, onChange, disabled = false, requiresVersionBump = false, onUploadingChange }: Readonly<{
  value: TopicActivityV2Test
  onChange: (value: TopicActivityV2Test) => void
  disabled?: boolean
  requiresVersionBump?: boolean
  onUploadingChange?: (uploading: boolean) => void
}>) {
  const uploads = useRef(new Set<string>())
  const [imageUploading, setImageUploading] = useState(false)
  function uploadingChanged(id: string, uploading: boolean) {
    if (uploading) uploads.current.add(id)
    else uploads.current.delete(id)
    const active = uploads.current.size > 0
    setImageUploading(active)
    onUploadingChange?.(active)
  }
  function patch(partial: Partial<TopicActivityV2Test>) { onChange({ ...value, ...partial }) }
  function question(index: number, partial: Partial<TopicActivityV2TestQuestion>) {
    patch({ questions: value.questions.map((item, position) => position === index ? { ...item, ...partial } : item) })
  }
  function result(index: number, partial: Partial<TopicActivityV2TestResult>) {
    patch({ results: value.results.map((item, position) => position === index ? { ...item, ...partial } : item) })
  }
  function changeMode(mode: TopicActivityV2Test['mode']) {
    patch({ mode, results: value.results.map((item) => mode === 'KNOWLEDGE'
      ? { ...item, scoreMin: item.scoreMin ?? 0, scoreMax: item.scoreMax ?? 0 }
      : { id: item.id, title: item.title, description: item.description, ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}) }),
    questions: value.questions.map((item) => mode === 'KNOWLEDGE'
      ? { ...item, correctOptionId: item.correctOptionId && item.options.some((option) => option.id === item.correctOptionId) ? item.correctOptionId : item.options[0]?.id, options: item.options.map((option) => {
        const withoutWeights = { ...option }
        delete withoutWeights.weights
        return withoutWeights
      }) }
      : { ...item, correctOptionId: undefined, options: item.options.map((option) => ({ ...option, weights: Object.fromEntries(value.results.map((row) => [row.id, option.weights?.[row.id] ?? 0])) })) }) })
  }
  function addQuestion() {
    const firstOptionId = createWizardId('option')
    const secondOptionId = createWizardId('option')
    const options = [firstOptionId, secondOptionId].map((id, index) => ({ id, label: `选项 ${index + 1}`, ...(value.mode === 'PERSONALITY' ? { weights: Object.fromEntries(value.results.map((row) => [row.id, 0])) } : {}) }))
    const nextQuestion: TopicActivityV2TestQuestion = { id: createWizardId('test'), prompt: '', points: 1, options,
      ...(value.mode === 'KNOWLEDGE' ? { correctOptionId: firstOptionId } : {}) }
    patch({ questions: [...value.questions, nextQuestion] })
  }
  function addResult() {
    const nextResult: TopicActivityV2TestResult = { id: createWizardId('test'), title: `结果 ${value.results.length + 1}`, description: '请填写结果说明',
      ...(value.mode === 'KNOWLEDGE' ? { scoreMin: 0, scoreMax: 0 } : {}) }
    patch({ results: [...value.results, nextResult], questions: value.questions.map((item) => ({ ...item,
      options: item.options.map((option) => ({ ...option, ...(value.mode === 'PERSONALITY' ? { weights: { ...option.weights, [nextResult.id]: 0 } } : {}) })) })) })
  }

  return <fieldset disabled={disabled || imageUploading} className="space-y-5">
    <fieldset disabled={disabled} className="space-y-4 border border-[var(--border)] p-3">
      <legend className="px-1 font-bold">测试题设置（可选）</legend>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />启用测试题</label>
      {value.enabled ? <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">测试标题<input className={inputClass} maxLength={160} value={value.title} onChange={(event) => patch({ title: event.target.value })} /></label>
          <label className="text-sm">测试模式<select className={inputClass} value={value.mode} onChange={(event) => changeMode(event.target.value as TopicActivityV2Test['mode'])}><option value="KNOWLEDGE">知识测试（单选，有正确答案）</option><option value="PERSONALITY">趣味测试（按选项权重匹配结果）</option></select></label>
          {requiresVersionBump ? <label className="text-sm">测试版本<input className={inputClass} type="number" min={1} step={1} value={value.version} onChange={(event) => patch({ version: Number(event.target.value) })} /><span className="mt-1 block text-xs text-[var(--foreground-muted)]">已有答题记录。若修改题目，请填写高于当前版本的版本号；历史答题会保留。</span></label> : null}
        </div>
        <label className="block text-sm">测试说明<textarea className={inputClass} rows={2} maxLength={2000} value={value.description} onChange={(event) => patch({ description: event.target.value })} /></label>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={value.allowRetake} onChange={(event) => patch({ allowRetake: event.target.checked })} />允许重新测试</label>
        <p className="text-xs text-[var(--foreground-muted)]">当前服务端只定义知识单选和趣味权重两种模式；没有多选、判断题、单题时限或答题次数上限字段，本向导不会新增这些规则。</p>
      </> : <p className="text-sm text-[var(--foreground-muted)]">测试关闭时不会要求填写题目，已有配置会保留；关闭仅在保存时提交该开关。</p>}
    </fieldset>

    {value.enabled ? <>
      <section className="space-y-3 border border-[var(--border)] p-3" aria-label="测试题目">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">题目</h3><button type="button" className={buttonClass} disabled={disabled} onClick={addQuestion}>添加题目</button></div>
        {value.questions.map((item, index) => <article key={item.id} className="space-y-3 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">第 {index + 1} 题</h4><div className="flex gap-2"><button type="button" className={buttonClass} disabled={disabled || index === 0} onClick={() => patch({ questions: move(value.questions, index, -1) })}>上移</button><button type="button" className={buttonClass} disabled={disabled || index === value.questions.length - 1} onClick={() => patch({ questions: move(value.questions, index, 1) })}>下移</button><button type="button" className={buttonClass} disabled={disabled} onClick={() => patch({ questions: value.questions.filter((questionItem) => questionItem.id !== item.id) })}>删除</button></div></div>
          <label className="block text-sm">题干<textarea className={inputClass} rows={2} value={item.prompt} onChange={(event) => question(index, { prompt: event.target.value })} /></label>
          <label className="block max-w-48 text-sm">题目分值<input className={inputClass} type="number" min={0} value={item.points} onChange={(event) => question(index, { points: Number(event.target.value) })} /></label>
          <div className="space-y-2"><p className="text-sm font-semibold">选项{value.mode === 'KNOWLEDGE' ? '（选择正确答案）' : '（设置各结果权重）'}</p>
            {item.options.map((option, optionIndex) => <div key={option.id} className="grid gap-2 border border-[var(--border)] p-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-2"><label className="block text-sm">选项 {optionIndex + 1}<input className={inputClass} value={option.label} onChange={(event) => question(index, { options: item.options.map((current) => current.id === option.id ? { ...current, label: event.target.value } : current) })} /></label>
                {value.mode === 'PERSONALITY' ? <div className="grid gap-2 sm:grid-cols-2">{value.results.map((row) => <label key={row.id} className="text-xs">{row.title} 权重<input className={inputClass} type="number" value={option.weights?.[row.id] ?? 0} onChange={(event) => question(index, { options: item.options.map((current) => current.id === option.id ? { ...current, weights: { ...current.weights, [row.id]: Number(event.target.value) } } : current) })} /></label>)}</div> : <label className="flex min-h-9 items-center gap-2 text-sm"><input type="radio" name={`correct-${item.id}`} checked={item.correctOptionId === option.id} onChange={() => question(index, { correctOptionId: option.id })} />正确答案</label>}</div>
              <div className="flex flex-wrap items-start gap-2"><button type="button" className={buttonClass} disabled={disabled || optionIndex === 0} onClick={() => question(index, { options: move(item.options, optionIndex, -1) })}>上移</button><button type="button" className={buttonClass} disabled={disabled || optionIndex === item.options.length - 1} onClick={() => question(index, { options: move(item.options, optionIndex, 1) })}>下移</button><button type="button" className={buttonClass} disabled={disabled || item.options.length <= 2} onClick={() => question(index, { options: item.options.filter((current) => current.id !== option.id), ...(item.correctOptionId === option.id ? { correctOptionId: undefined } : {}) })}>删除选项</button></div>
            </div>)}
            {value.mode === 'KNOWLEDGE' && (!item.correctOptionId || !item.options.some((option) => option.id === item.correctOptionId)) ? <p role="alert" className="text-sm text-[var(--danger)]">请选择仍存在于本题的正确答案。</p> : null}
            <button type="button" className={buttonClass} disabled={disabled || item.options.length >= 50} onClick={() => question(index, { options: [...item.options, { id: createWizardId('option'), label: '', ...(value.mode === 'PERSONALITY' ? { weights: Object.fromEntries(value.results.map((row) => [row.id, 0])) } : {}) }] })}>添加选项</button>
          </div>
          <section className="space-y-1 border border-[var(--border)] bg-[var(--surface-muted)] p-3" aria-label={`第 ${index + 1} 题预览`}><p className="text-xs text-[var(--foreground-muted)]">预览</p><p className="font-semibold">{item.prompt || '题目内容预览'}</p>{item.options.map((option) => <p key={option.id} className="text-sm">○ {option.label || '未填写选项'}</p>)}</section>
        </article>)}
      </section>

      <section className="space-y-3 border border-[var(--border)] p-3" aria-label="测试结果">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">结果</h3><button type="button" className={buttonClass} disabled={disabled || value.results.length >= 100} onClick={addResult}>添加结果</button></div>
        {value.results.map((row, index) => <article key={row.id} className="space-y-2 border-t border-[var(--border)] pt-3">
          <div className="flex items-center justify-between"><h4 className="font-semibold">结果 {index + 1}</h4><button type="button" className={buttonClass} disabled={disabled || value.results.length <= 1} onClick={() => {
            const results = value.results.filter((item) => item.id !== row.id)
            patch({ results, questions: value.questions.map((item) => ({ ...item, options: item.options.map((option) => {
              if (!option.weights) return option
              const weights = { ...option.weights }; delete weights[row.id]; return { ...option, weights }
            }) })) })
          }}>删除结果</button></div>
          <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">结果标题<input className={inputClass} value={row.title} onChange={(event) => result(index, { title: event.target.value })} /></label><label className="text-sm">结果说明<input className={inputClass} value={row.description} onChange={(event) => result(index, { description: event.target.value })} /></label></div>
          <div role="group" aria-label={`结果 ${index + 1} 图片`}><TopicActivityEditorImageUploader value={row.imageUrl || null} disabled={disabled || imageUploading} onUploadingChange={(uploading) => uploadingChanged(row.id, uploading)} onChange={(imageUrl) => patch({ results: value.results.map((item) => item.id === row.id ? { ...item, imageUrl: imageUrl || undefined } : item) })} /></div>
          {value.mode === 'KNOWLEDGE' ? <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">最低分（包含）<input className={inputClass} type="number" min={0} value={row.scoreMin ?? ''} onChange={(event) => result(index, { scoreMin: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label className="text-sm">最高分（包含）<input className={inputClass} type="number" min={0} value={row.scoreMax ?? ''} onChange={(event) => result(index, { scoreMax: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></div> : null}
        </article>)}
        {value.mode === 'KNOWLEDGE' ? <p className="text-xs text-[var(--foreground-muted)]">知识测试结果分数区间必须连续、无重叠，并完整覆盖 0 到题目总分。</p> : null}
      </section>

      <details className="border border-[var(--border)] p-3 text-sm"><summary className="cursor-pointer font-semibold">分享海报设置</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="flex items-center gap-2"><input type="checkbox" checked={value.poster.showNickname} onChange={(event) => patch({ poster: { ...value.poster, showNickname: event.target.checked } })} />显示昵称</label><label className="flex items-center gap-2"><input type="checkbox" checked={value.poster.showQrCode} onChange={(event) => patch({ poster: { ...value.poster, showQrCode: event.target.checked } })} />显示活动二维码</label></div></details>
    </> : null}
  </fieldset>
}
