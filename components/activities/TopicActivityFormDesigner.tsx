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
  return <section className="topic-activity-form-builder space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-black text-[var(--foreground)]">用户参与表单</h4><p className="mt-1 text-xs text-[var(--foreground-muted)]">表单版本会随每次提交保存，之后修改不会改变历史答案。</p></div><label className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]"><input type="checkbox" checked={allowImages} onChange={(event) => onAllowImagesChange(event.target.checked)} />允许图片附件</label></div>
    {schema.fields.map((field, index) => <article key={field.id} className="topic-activity-form-field grid min-w-0 gap-4 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_190px]"><div className="min-w-0 space-y-3"><label className="block text-xs font-black text-[var(--foreground-muted)]">字段标题<input aria-label={`字段 ${index + 1} 标题`} value={field.label} maxLength={160} onChange={(event) => updateField(field.id, { label: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border px-3 text-sm font-bold" placeholder="例如：你最喜欢哪首歌？" /></label>{field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT' ? <label className="block text-xs font-black text-[var(--foreground-muted)]">选项（每行一个）<textarea aria-label={`${field.label}选项`} value={field.options.map((option) => option.label).join('\n')} onChange={(event) => updateOptions(field, event.target.value)} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-medium" placeholder="每行一个选项" /></label> : null}{field.type === 'IMAGE' ? <label className="flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--foreground-muted)]"><input type="checkbox" checked={field.multiple} onChange={(event) => updateField(field.id, { multiple: event.target.checked, maxImages: event.target.checked ? Math.max(2, field.maxImages) : 1 })} />允许多张图片（最多 9 张）{field.multiple ? <input aria-label="图片数量上限" type="number" min={2} max={9} value={field.maxImages} onChange={(event) => updateField(field.id, { maxImages: Math.min(9, Math.max(2, Number(event.target.value) || 2)) })} className="w-20 rounded-lg border px-2 py-1 text-sm" /> : null}</label> : null}<label className="inline-flex items-center gap-2 text-xs font-bold text-[var(--foreground-muted)]"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} />必填字段</label></div><div className="flex min-w-0 flex-col gap-3"><label className="block text-xs font-black text-[var(--foreground-muted)]">字段类型<select aria-label={`字段 ${index + 1} 类型`} value={field.type} onChange={(event) => updateField(field.id, { type: event.target.value as TopicActivityFormFieldType })} className="mt-1 min-h-10 w-full rounded-lg border px-3 text-sm font-bold">{fieldTypes.map((item) => <option key={item.value} value={item.value} disabled={item.value === 'IMAGE' && !allowImages}>{item.label}</option>)}</select></label><button type="button" onClick={() => onSchemaChange({ ...schema, fields: schema.fields.filter((item) => item.id !== field.id) })} className="min-h-10 self-start rounded-lg px-2 text-sm font-bold text-[var(--danger)]">删除字段</button></div></article>)}
    <div className="flex flex-wrap gap-2">{fieldTypes.map((item) => <button key={item.value} type="button" disabled={item.value === 'IMAGE' && !allowImages || schema.fields.length >= 30} onClick={() => onSchemaChange({ ...schema, fields: [...schema.fields, makeField(item.value, schema.fields.length)] })} className="min-h-10 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)] disabled:opacity-40">+ 添加{item.label}字段</button>)}</div>
  </section>
}
