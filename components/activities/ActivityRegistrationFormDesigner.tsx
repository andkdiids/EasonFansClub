'use client'

import { useId } from 'react'
import { activityRegistrationQuestionTypeValues, type ActivityRegistrationQuestionType } from '@/lib/activity-registration-shared'

export type ActivityQuestionDraft = {
  id: string
  title: string
  type: ActivityRegistrationQuestionType
  required: boolean
  placeholder: string
  sortOrder: number
  options: Array<{ id: string; label: string; value: string; sortOrder: number }>
}

const labels: Record<ActivityRegistrationQuestionType, string> = {
  TEXT: '单行文本',
  TEXTAREA: '多行文本',
  SINGLE_SELECT: '单选',
  MULTI_SELECT: '多选',
  NUMBER: '数字',
  PHONE: '手机号',
  SELECT: '下拉选择',
}

const choiceTypes = new Set<ActivityRegistrationQuestionType>(['SINGLE_SELECT', 'MULTI_SELECT', 'SELECT'])

function isChoice(type: ActivityRegistrationQuestionType) {
  return choiceTypes.has(type)
}

function emptyQuestion(index: number): ActivityQuestionDraft {
  return { id: `question-${Date.now()}-${index}`, title: '', type: 'TEXT', required: false, placeholder: '', sortOrder: index, options: [] }
}

function emptyOption(index: number) {
  return { id: `option-${Date.now()}-${index}`, label: '', value: `option-${index + 1}`, sortOrder: index }
}

export function ActivityRegistrationFormDesigner({ questions, onChange }: Readonly<{ questions: ActivityQuestionDraft[]; onChange: (questions: ActivityQuestionDraft[]) => void }>) {
  const formId = useId()
  function update(index: number, patch: Partial<ActivityQuestionDraft>) {
    onChange(questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question))
  }
  function updateOption(questionIndex: number, optionIndex: number, patch: Partial<ActivityQuestionDraft['options'][number]>) {
    onChange(questions.map((question, index) => index === questionIndex ? { ...question, options: question.options.map((option, itemIndex) => itemIndex === optionIndex ? { ...option, ...patch } : option) } : question))
  }
  function changeType(index: number, type: ActivityRegistrationQuestionType) {
    const question = questions[index]
    if (!question) return
    update(index, { type, options: isChoice(type) ? (question.options.length ? question.options : [emptyOption(0)]) : [] })
  }

  return (
    <section className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4 dark:border-slate-700 dark:bg-slate-950/50" aria-labelledby={`${formId}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 id={`${formId}-title`} className="text-lg font-black text-brand-950 dark:text-slate-100">报名表问题（可选）</h3><p className="mt-1 text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">没有问题时，用户只需在详情页确认报名；题目和答案会保留快照。</p></div>
        <button type="button" onClick={() => onChange([...questions, emptyQuestion(questions.length)])} className="min-h-9 rounded-full border border-brand-700 px-3 text-xs font-black text-brand-700 dark:border-sky-300 dark:text-sky-200">添加问题</button>
      </div>
      <div className="mt-3 space-y-3">
        {questions.map((question, index) => (
          <div key={question.id} className="rounded-xl border border-sky-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black text-slate-400">问题 {index + 1}</span>
              <button type="button" onClick={() => onChange(questions.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, sortOrder: itemIndex })))} className="ml-auto text-xs font-black text-rose-600">删除</button>
              {index > 0 ? <button type="button" onClick={() => { const next = [...questions]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next.map((item, itemIndex) => ({ ...item, sortOrder: itemIndex }))) }} className="text-xs font-black text-slate-500">上移</button> : null}
              {index < questions.length - 1 ? <button type="button" onClick={() => { const next = [...questions]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; onChange(next.map((item, itemIndex) => ({ ...item, sortOrder: itemIndex }))) }} className="text-xs font-black text-slate-500">下移</button> : null}
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem]">
              <input value={question.title} onChange={(event) => update(index, { title: event.target.value })} maxLength={300} placeholder="问题标题" className="min-h-10 min-w-0 rounded-lg border border-sky-100 bg-white px-3 text-sm font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
              <select value={question.type} onChange={(event) => changeType(index, event.target.value as ActivityRegistrationQuestionType)} className="min-h-10 rounded-lg border border-sky-100 bg-white px-3 text-sm font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">{activityRegistrationQuestionTypeValues.map((type) => <option key={type} value={type}>{labels[type]}</option>)}</select>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input value={question.placeholder} onChange={(event) => update(index, { placeholder: event.target.value })} maxLength={300} placeholder="占位提示（可选）" className="min-h-9 min-w-[12rem] flex-1 rounded-lg border border-sky-100 bg-white px-3 text-sm font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
              <label className="flex min-h-9 items-center gap-2 text-xs font-black text-slate-600 dark:text-slate-300"><input type="checkbox" checked={question.required} onChange={(event) => update(index, { required: event.target.checked })} />必填</label>
            </div>
            {isChoice(question.type) ? <div className="mt-2 rounded-lg bg-sky-50/80 p-2 dark:bg-slate-950/80"><div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-slate-500 dark:text-slate-400">选项</span><button type="button" onClick={() => update(index, { options: [...question.options, emptyOption(question.options.length)] })} className="text-xs font-black text-brand-700 dark:text-sky-200">添加选项</button></div><div className="mt-2 space-y-2">{question.options.map((option, optionIndex) => <div key={option.id} className="flex min-w-0 gap-2"><input value={option.label} onChange={(event) => updateOption(index, optionIndex, { label: event.target.value })} maxLength={300} placeholder={`选项 ${optionIndex + 1}`} className="min-h-9 min-w-0 flex-1 rounded-lg border border-sky-100 bg-white px-2 text-sm font-bold dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /><button type="button" onClick={() => update(index, { options: question.options.filter((_, itemIndex) => itemIndex !== optionIndex).map((item, itemIndex) => ({ ...item, sortOrder: itemIndex })) })} className="px-2 text-xs font-black text-rose-600">删除</button></div>)}</div></div> : null}
          </div>
        ))}
        {!questions.length ? <p className="rounded-xl border border-dashed border-sky-200 px-3 py-4 text-center text-xs font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">暂无自定义问题，发布后会显示轻量确认弹窗。</p> : null}
      </div>
    </section>
  )
}
