'use client'

import { topicResultDescriptionVariants, type TopicActivityV2TestResult } from '@/lib/topic-activity-v2-config'
import { createWizardId } from './TopicActivityWizardIds'

type Variant = { id: string; text: string }
export function TopicActivityResultDescriptions({ result, onChange }: {
  result: TopicActivityV2TestResult
  onChange: (value: Pick<TopicActivityV2TestResult, 'description' | 'descriptionVariants'>) => void
}) {
  const variants = topicResultDescriptionVariants(result)
  const change = (next: Variant[]) => onChange({ descriptionVariants: next, description: next[0]?.text || '' })
  function move(index: number, direction: -1 | 1) {
    const next = [...variants]
    ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
    change(next)
  }
  return <fieldset className="space-y-3">
    <legend className="text-sm font-semibold">结果说明</legend>
    <p className="text-xs text-[var(--foreground-muted)]">完成测试时等概率选中一条，同一次结果的刷新、历史和海报保持一致。</p>
    {variants.map((variant, index) => <div key={variant.id} className="space-y-2">
      <label className="block text-sm">{variants.length === 1 ? '结果说明' : `说明 ${index + 1}`}<textarea rows={3} maxLength={8000} className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] p-2" value={variant.text}
        onChange={(event) => change(variants.map((item) => item.id === variant.id ? { ...item, text: event.target.value } : item))} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-10 border px-3 text-sm disabled:opacity-40" disabled={index === 0} onClick={() => move(index, -1)}>说明上移</button>
        <button type="button" className="min-h-10 border px-3 text-sm disabled:opacity-40" disabled={index === variants.length - 1} onClick={() => move(index, 1)}>说明下移</button>
        <button type="button" className="min-h-10 border px-3 text-sm disabled:opacity-40" disabled={variants.length <= 1} onClick={() => change(variants.filter((item) => item.id !== variant.id))}>删除说明</button>
      </div>
    </div>)}
    <button type="button" className="min-h-10 border px-3 text-sm" onClick={() => change([...variants, { id: createWizardId('description'), text: '' }])}>+ 添加结果说明</button>
  </fieldset>
}
