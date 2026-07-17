'use client'

import { useState } from 'react'

type Question = { question: string; answer: string }

export function SecurityQuestionsForm() {
  const [questions, setQuestions] = useState<Question[]>(Array.from({ length: 3 }, () => ({ question: '', answer: '' })))
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function update(index: number, field: keyof Question, value: string) {
    setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setError('')
    setMessage('')
    setSaving(true)
    const response = await fetch('/api/account/security/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ securityQuestions: questions }),
    })
    const data = await response.json().catch(() => ({}))
    setSaving(false)
    if (!response.ok) {
      setError(data.message || '设置失败')
      return
    }
    setMessage(data.message || '设置成功')
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm">
      <div className="rounded-2xl bg-amber-50 px-4 py-2 text-sm font-black leading-7 text-amber-800">
        密保问题设置后不可修改，请妥善保存答案。管理员无法查看你的答案。
      </div>
      {questions.map((item, index) => (
        <section key={index} className="space-y-3 rounded-2xl bg-sky-50/60 p-4">
          <label className="block text-sm font-black text-brand-950">密保问题 {index + 1}</label>
          <input value={item.question} onChange={(event) => update(index, 'question', event.target.value)} required maxLength={120} className="w-full rounded-xl border border-sky-100 bg-white px-4 py-2 font-bold outline-none focus:border-brand-500" placeholder="请自行填写问题内容" />
          <input value={item.answer} onChange={(event) => update(index, 'answer', event.target.value)} required maxLength={200} autoComplete="off" className="w-full rounded-xl border border-sky-100 bg-white px-4 py-2 font-bold outline-none focus:border-brand-500" placeholder="填写答案" />
        </section>
      ))}
      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700">{error}</p> : null}
      <button disabled={saving || Boolean(message)} className="w-full rounded-2xl bg-brand-950 px-5 py-3 font-black text-white disabled:opacity-50">{saving ? '保存中...' : '确认并永久保存'}</button>
    </form>
  )
}
