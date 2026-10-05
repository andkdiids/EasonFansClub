'use client'

import type { TopicActivityFormField, TopicActivityFormSchema, TopicActivityFormFieldType } from '@/lib/topic-activity-form'

const fieldTypes: Array<{ value: TopicActivityFormFieldType; label: string }> = [
  { value: 'TEXT', label: '单行文字' },
  { value: 'TEXTAREA', label: '多行文字' },
  { value: 'SINGLE_SELECT', label: '单选' },
  { value: 'MULTI_SELECT', label: '多选' },
  { value: 'IMAGE', label: '图片' },
]

function makeField(type: TopicActivityFormFieldType, index: number): TopicActivityFormField {
  return { id: `field-${crypto.randomUUID()}`, label: `问题 ${index + 1}`, type, required: false, placeholder: null, options: type === 'SINGLE_SELECT' || type === 'MULTI_SELECT' ? [{ value: 'option-1', label: '选项一' }, { value: 'option-2', label: '选项二' }] : [], multiple: false, maxImages: 1 }
}

export function TopicActivityFormDesigner({ schema, allowImages, onSchemaChange, onAllowImagesChange }: {
  schema: TopicActivityFormSchema
  allowImages: boolean
  onSchemaChange: (schema: TopicActivityFormSchema) => void
  onAllowImagesChange: (enabled: boolean) => void
}) {
  function updateField(id: string, patch: Partial<TopicActivityFormField>) {
    onSchemaChange({ ...schema, fields: schema.fields.map((field) => field.id === id ? { ...field, ...patch, ...(patch.type && patch.type !== field.type ? { options: patch.type === 'SINGLE_SELECT' || patch.type === 'MULTI_SELECT' ? [{ value: 'option-1', label: '选项一' }, { value: 'option-2', label: '选项二' }] : [], multiple: false, maxImages: 1 } : {}) } : field) })
  }
  function updateOptions(field: TopicActivityFormField, input: string) {
    const options = input.split('\n').map((label) => label.trim()).filter(Boolean).slice(0, 30).map((label, index) => ({ label, value: `option-${index + 1}` }))
    updateField(field.id, { options })
  }
  return <section className="space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-900/70">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-black text-slate-800 dark:text-slate-100">用户参与表单</h4><p className="mt-1 text-xs text-slate-500">表单版本会随每次提交保存，之后修改不会改变历史答案。</p></div><label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={allowImages} onChange={(event) => onAllowImagesChange(event.target.checked)} />允许图片附件</label></div>
    {schema.fields.map((field, index) => <article key={field.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950 md:grid-cols-[minmax(0,1fr)_180px_auto]"><div className="space-y-2"><input aria-label={`字段 ${index + 1} 标题`} value={field.label} maxLength={160} onChange={(event) => updateField(field.id, { label: event.target.value })} className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900" placeholder="问题标题" />{field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT' ? <textarea aria-label={`${field.label}选项`} value={field.options.map((option) => option.label).join('\n')} onChange={(event) => updateOptions(field, event.target.value)} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="每行一个选项" /> : null}{field.type === 'IMAGE' ? <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300"><input type="checkbox" checked={field.multiple} onChange={(event) => updateField(field.id, { multiple: event.target.checked, maxImages: event.target.checked ? Math.max(2, field.maxImages) : 1 })} />允许多张（最多 9 张）{field.multiple ? <input aria-label="图片数量上限" type="number" min={2} max={9} value={field.maxImages} onChange={(event) => updateField(field.id, { maxImages: Math.min(9, Math.max(2, Number(event.target.value) || 2)) })} className="w-16 rounded border px-2 py-1 dark:border-slate-700 dark:bg-slate-900" /> : null}</label> : null}<label className="flex items-center gap-2 text-xs font-bold text-slate-500"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} />必填</label></div><select aria-label="字段类型" value={field.type} onChange={(event) => updateField(field.id, { type: event.target.value as TopicActivityFormFieldType })} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-900">{fieldTypes.map((item) => <option key={item.value} value={item.value} disabled={item.value === 'IMAGE' && !allowImages}>{item.label}</option>)}</select><button type="button" onClick={() => onSchemaChange({ ...schema, fields: schema.fields.filter((item) => item.id !== field.id) })} className="min-h-10 rounded-lg px-3 text-sm font-bold text-red-600">删除</button></article>)}
    <div className="flex flex-wrap gap-2">{fieldTypes.map((item) => <button key={item.value} type="button" disabled={item.value === 'IMAGE' && !allowImages || schema.fields.length >= 30} onClick={() => onSchemaChange({ ...schema, fields: [...schema.fields, makeField(item.value, schema.fields.length)] })} className="min-h-9 rounded-full border border-slate-300 px-3 text-xs font-bold text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">+ {item.label}</button>)}</div>
  </section>
}
