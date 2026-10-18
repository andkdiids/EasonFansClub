'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createDefaultTopicActivityV2Program, readTopicActivityV2Program, type TopicActivityV2Program, type TopicRewardEntryConfig } from '@/lib/topic-activity-v2-config'
import { TopicActivityV2FixedRewardReview } from '@/components/activities/TopicActivityV2FixedRewardReview'
import { TopicActivityV2Statistics } from '@/components/activities/TopicActivityV2Statistics'
import { TopicActivityV2LotteryAdmin } from '@/components/activities/TopicActivityV2LotteryAdmin'
import { TopicActivityPosterBackgroundUploader, topicActivityEditorImagesMatch } from '@/components/activities/TopicActivityPosterBackgroundUploader'
import { TopicActivityPosterPreview } from '@/components/activities/TopicActivityPosterPreview'
import { TopicActivityResultWeightRoles } from '@/components/activities/TopicActivityResultWeightRoles'
import { TopicActivityResultDescriptions } from '@/components/activities/TopicActivityResultDescriptions'
import { TopicActivityRewardReleaseSettings } from '@/components/activities/TopicActivityRewardReleaseEditor'
import { migrateTopicActivityWeightsToRoles, topicActivityResultReferenceCount } from '@/lib/topic-activity-result-weight-roles'

const inputClass = 'mt-1 min-h-10 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 text-sm'
const buttonClass = 'min-h-9 rounded-sm border border-[var(--border)] px-3 text-sm font-bold disabled:opacity-40'
const platforms = [['weibo', '微博'], ['xiaohongshu', '小红书'], ['douyin', '抖音'], ['instagram', 'Instagram'], ['bilibili', 'B 站'], ['wechat-channels', '视频号']]
function uid(prefix: string) { return prefix + '-' + crypto.randomUUID().slice(0, 12) }
function localTime(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? new Date(parsed.getTime() + 8 * 3600_000).toISOString().slice(0, 16) : value
}
function Field({ label, value, onChange, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  return <label className="block text-sm">{label}<input className={inputClass} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />{label}</label>
}
function Group({ title, children }: { title: string; children: ReactNode }) { return <fieldset className="space-y-3 border border-[var(--border)] p-3"><legend className="px-1 font-bold">{title}</legend>{children}</fieldset> }
function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm">{label}<textarea className={inputClass + ' p-2'} rows={3} value={value} onChange={(event) => onChange(event.target.value)} /></label>
}
function newEntry(index: number): TopicRewardEntryConfig { return { id: uid('entry'), platformKey: 'weibo', platformName: '微博', title: '', instructions: '', materialRequirement: '', minImages: 1, maxImages: 3, points: 0, enabled: true, sortOrder: index, startsAt: null, endsAt: null, allowResubmit: false } }

export function TopicActivityV2Editor({ activityId, disabled = false, onSaved }: { activityId: string; disabled?: boolean; onSaved?: (program: TopicActivityV2Program) => void }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false)
  const [program, setProgram] = useState<TopicActivityV2Program>(createDefaultTopicActivityV2Program)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const [badges, setBadges] = useState<Array<{ id: string; name: string; iconUrl: string | null }>>([])
  const [postId, setPostId] = useState<string | null>(null)
  const [posterUploading, setPosterUploading] = useState(false)
  const [resultDeleteError, setResultDeleteError] = useState('')
  const imageUploads = useRef(new Set<string>())
  function imageUploading(id: string, uploading: boolean) {
    if (uploading) imageUploads.current.add(id)
    else imageUploads.current.delete(id)
    setPosterUploading(imageUploads.current.size > 0)
  }
  const busy = useRef(false)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError('')
    void fetch('/api/admin/activities/' + encodeURIComponent(activityId) + '/v2', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => { const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.message || '配置加载失败'); const value = readTopicActivityV2Program(body.program); if (!value) throw new Error('活动配置格式不可用'); setProgram(value); setPostId(body.activity?.activityPostId || null) })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '配置加载失败') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    void fetch('/api/admin/activities/badges', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal }).then(async (response) => {
      const body = await response.json().catch(() => null); if (response.ok && Array.isArray(body?.badges)) setBadges(body.badges)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [open, activityId])
  function patch(value: Partial<TopicActivityV2Program>) { setProgram((current) => ({ ...current, ...value })) }
  function entryAt(index: number, value: Partial<TopicRewardEntryConfig>) { setProgram((current) => ({ ...current, entries: current.entries.map((entry, position) => position === index ? { ...entry, ...value } : entry) })) }
  function poll(value: Partial<TopicActivityV2Program['poll']>) { setProgram((current) => ({ ...current, poll: { ...current.poll, ...value } })) }
  function test(value: Partial<TopicActivityV2Program['test']>) { setProgram((current) => ({ ...current, test: { ...current.test, ...value } })) }
  function changeTestMode(mode: TopicActivityV2Program['test']['mode']) {
    const current = program.test
    const scoringMode = mode === 'PERSONALITY' && current.mode !== 'PERSONALITY' ? 'RESULT_WEIGHT_ROLES_V1' : current.scoringMode || 'LEGACY_WEIGHTED'
    test({ mode, scoringMode,
      results: current.results.map((row) => mode === 'KNOWLEDGE'
        ? { ...row, scoreMin: row.scoreMin ?? 0, scoreMax: row.scoreMax ?? 0 }
        : { id: row.id, title: row.title, description: row.description, ...(row.descriptionVariants ? { descriptionVariants: row.descriptionVariants } : {}), ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}) }),
      questions: current.questions.map((question) => mode === 'KNOWLEDGE'
        ? { ...question, correctOptionId: question.correctOptionId && question.options.some((option) => option.id === question.correctOptionId) ? question.correctOptionId : question.options[0]?.id,
          options: question.options.map((option) => { const next = { ...option }; delete next.weights; return next }) }
        : { ...question, correctOptionId: undefined, questionWeight: question.questionWeight ?? 1, options: question.options.map((option) => ({ ...option,
          weights: scoringMode === 'RESULT_WEIGHT_ROLES_V1' ? migrateTopicActivityWeightsToRoles(option.weights, current.results)
            : Object.fromEntries(current.results.map((row) => [row.id, option.weights?.[row.id] ?? 0])) })) }) })
  }
  function changeScoringMode(scoringMode: NonNullable<TopicActivityV2Program['test']['scoringMode']>) {
    const current = program.test
    test({ scoringMode, questions: current.questions.map((question) => ({ ...question, questionWeight: question.questionWeight ?? 1,
      options: question.options.map((option) => ({ ...option, weights: scoringMode === 'RESULT_WEIGHT_ROLES_V1'
        ? migrateTopicActivityWeightsToRoles(option.weights, current.results)
        : Object.fromEntries(current.results.map((row) => [row.id, option.weights?.[row.id] ?? 0])) })) })) })
  }
  function fixed(value: Partial<TopicActivityV2Program['fixedReward']>) { setProgram((current) => ({ ...current, fixedReward: { ...current.fixedReward, ...value } })) }
  function medal(value: Partial<TopicActivityV2Program['medal']>) { setProgram((current) => ({ ...current, medal: { ...current.medal, ...value } })) }
  function questionAt(index: number, value: Partial<TopicActivityV2Program['test']['questions'][number]>) {
    setProgram((current) => ({ ...current, test: { ...current.test, questions: current.test.questions.map((question, position) => position === index ? { ...question, ...value } : question) } }))
  }
  function removeTestResult(resultId: string) {
    const references = topicActivityResultReferenceCount(program.test.questions, resultId)
    if (references) { setResultDeleteError(`该结果仍被 ${references} 个选项使用，请先调整选项权重。`); return }
    setResultDeleteError('')
    test({ results: program.test.results.filter((item) => item.id !== resultId), questions: program.test.questions.map((question) => ({
      ...question, options: question.options.map((option) => {
        const weights = { ...option.weights }; delete weights[resultId]; return { ...option, weights }
      }),
    })) })
  }
  function addTestQuestion() {
    const resultId = program.test.results[0]?.id
    const roleWeights = program.test.mode === 'PERSONALITY' && program.test.scoringMode === 'RESULT_WEIGHT_ROLES_V1' && resultId ? { [resultId]: 4 } : undefined
    const options = [1, 2].map((index) => ({ id: uid('test-option'), label: `选项 ${index}`, ...(roleWeights ? { weights: roleWeights } : {}) }))
    test({ questions: [...program.test.questions, { id: uid('question'), prompt: '', points: 1, ...(program.test.mode === 'PERSONALITY' ? { questionWeight: 1 } : {}), options,
      ...(program.test.mode === 'KNOWLEDGE' ? { correctOptionId: options[0].id } : {}) }] })
  }
  async function save() {
    if (busy.current || disabled || imageUploads.current.size > 0) return
    busy.current = true; setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/admin/activities/' + encodeURIComponent(activityId) + '/v2', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ program }) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '配置保存失败')
      const readback = await fetch('/api/admin/activities/' + encodeURIComponent(activityId) + '/v2', { cache: 'no-store', credentials: 'same-origin' })
      const confirmed = await readback.json().catch(() => null)
      if (!readback.ok) throw new Error(confirmed?.message || '配置已提交，但回读失败；输入已保留，请核对后继续。')
      const value = readTopicActivityV2Program(confirmed?.program)
      if (!value || !topicActivityEditorImagesMatch(program.test, value.test)) throw new Error('配置已提交，但图片回读不一致；输入已保留，请核对后继续。')
      if (value.test.poster.showNickname !== program.test.poster.showNickname || value.test.poster.showQrCode !== program.test.poster.showQrCode) throw new Error('配置已提交，但海报显示开关回读不一致；输入已保留，请核对后继续。')
      setProgram(value); setMessage('活动模块配置已保存并回读确认。'); onSaved?.(value)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
    finally { busy.current = false; setSaving(false) }
  }
  const badge = badges.find((item) => item.id === program.medal.badgeId)
  return <section className="mt-5 border border-[var(--border)] bg-[var(--surface)] p-4">
    <button type="button" className={buttonClass} disabled={disabled || saving || posterUploading} onClick={() => setOpen(!open)}>{open ? '收起活动模块配置' : '互动与平台奖励配置'}</button>
    {open ? <div className="mt-4 space-y-5"><p className="text-sm text-[var(--foreground-muted)]">旧活动默认不启用新模块。平台任务需要在基础活动设置开启图片附件；多入口及重交任务需要允许多次参与评论。</p>{loading ? <p>正在加载…</p> : <><fieldset disabled={disabled || saving || posterUploading} className="space-y-5">
      <TopicActivityRewardReleaseSettings activityId={activityId} disabled={disabled || saving} />
      <Group title="模块与展示"><Toggle label="启用本组活动模块" value={program.enabled} onChange={(value) => patch({ enabled: value })} /><div className="grid gap-2 sm:grid-cols-3"><Toggle label="话题参与和讨论" value={program.discussionEnabled} onChange={(value) => patch({ discussionEnabled: value })} /><Toggle label="展示参与规则" value={program.showRules} onChange={(value) => patch({ showRules: value })} /><Toggle label="展示奖励说明" value={program.showRewards} onChange={(value) => patch({ showRewards: value })} /></div><TextArea label="参与素材与分享说明" value={program.materials} onChange={(value) => patch({ materials: value })} /></Group>
      <Group title="平台奖励"><Toggle label="启用平台奖励入口" value={program.platformRewards.enabled} onChange={(value) => patch({ platformRewards: { ...program.platformRewards, enabled: value } })} /><Toggle label="允许跨平台分别领奖" value={program.platformRewards.allowStacking} onChange={(value) => patch({ platformRewards: { ...program.platformRewards, allowStacking: value } })} /><div className="grid gap-2 sm:grid-cols-2"><Field label="最多领奖平台数（留空不限）" type="number" value={program.platformRewards.maxPlatforms ?? ''} onChange={(value) => patch({ platformRewards: { ...program.platformRewards, maxPlatforms: value ? Number(value) : null } })} /><Field label="最多领奖任务数（留空不限）" type="number" value={program.platformRewards.maxEntries ?? ''} onChange={(value) => patch({ platformRewards: { ...program.platformRewards, maxEntries: value ? Number(value) : null } })} /></div><p className="text-xs">同一平台的多个入口各有独立奖励资格；平台上限按不同平台计算。关闭跨平台领奖后最多领奖一个平台。</p>
        {program.entries.map((entry, index) => <Group key={entry.id} title={'入口 ' + (index + 1)}><div className="flex flex-wrap justify-between gap-2"><Toggle label="启用此入口" value={entry.enabled} onChange={(value) => entryAt(index, { enabled: value })} /><button type="button" className={buttonClass} onClick={() => patch({ entries: program.entries.filter((item) => item.id !== entry.id) })}>移除 / 停用</button></div><div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">平台预设<select className={inputClass} value={platforms.some(([key]) => key === entry.platformKey) ? entry.platformKey : 'custom'} onChange={(event) => { const preset = platforms.find(([key]) => key === event.target.value); entryAt(index, preset ? { platformKey: preset[0], platformName: preset[1] } : { platformKey: uid('custom-platform'), platformName: '' }) }}>{platforms.map(([key, name]) => <option value={key} key={key}>{name}</option>)}<option value="custom">自定义平台</option></select></label><Field label="平台名称" value={entry.platformName} onChange={(value) => entryAt(index, { platformName: value })} /><Field label="入口标题" value={entry.title} onChange={(value) => entryAt(index, { title: value })} /><Field label="挂号费奖励" type="number" value={entry.points} onChange={(value) => entryAt(index, { points: Number(value) })} /></div><TextArea label="任务与平台发布要求" value={entry.instructions} onChange={(value) => entryAt(index, { instructions: value })} /><TextArea label="素材要求" value={entry.materialRequirement} onChange={(value) => entryAt(index, { materialRequirement: value })} /><div className="grid gap-2 sm:grid-cols-2"><Field label="最少截图数" type="number" value={entry.minImages} onChange={(value) => entryAt(index, { minImages: Number(value) })} /><Field label="最多截图数" type="number" value={entry.maxImages} onChange={(value) => entryAt(index, { maxImages: Number(value) })} /><Field label="提交开始（北京时间）" type="datetime-local" value={localTime(entry.startsAt)} onChange={(value) => entryAt(index, { startsAt: value || null })} /><Field label="提交截止（北京时间）" type="datetime-local" value={localTime(entry.endsAt)} onChange={(value) => entryAt(index, { endsAt: value || null })} /></div><Toggle label="拒绝后允许重新提交" value={entry.allowResubmit} onChange={(value) => entryAt(index, { allowResubmit: value })} /><button type="button" className={buttonClass} onClick={() => patch({ entries: program.entries.map((item) => item.platformKey === entry.platformKey ? { ...item, enabled: false } : item) })}>停用此平台全部入口</button><details className="text-xs"><summary>高级位置与身份</summary><p className="break-all">入口 ID：{entry.id}</p><Field label="平台稳定标识（同平台入口使用相同值）" value={entry.platformKey} onChange={(value) => entryAt(index, { platformKey: value })} /><Field label="排序" type="number" value={entry.sortOrder} onChange={(value) => entryAt(index, { sortOrder: Number(value) })} /><p>已被历史记录引用的入口只能停用，不能改变平台标识。</p></details></Group>)}
        <button type="button" className={buttonClass} onClick={() => patch({ entries: [...program.entries, newEntry(program.entries.length)] })}>+ 添加平台奖励入口</button>
      </Group>
      <Group title="固定奖励"><Toggle label="启用固定奖励" value={program.fixedReward.enabled} onChange={(value) => fixed({ enabled: value })} /><p className="text-xs">奖励类型：挂号费。每用户每活动只成功发放一次，与平台奖励独立。</p><Field label="奖励数量" type="number" value={program.fixedReward.points} onChange={(value) => fixed({ points: Number(value) })} /><TextArea label="奖励说明" value={program.fixedReward.description} onChange={(value) => fixed({ description: value })} /><label className="text-sm">发放条件<select className={inputClass} value={program.fixedReward.condition} onChange={(event) => fixed({ condition: event.target.value as TopicActivityV2Program['fixedReward']['condition'] })}><option value="APPROVED_COMMENT">有效站内参与评论通过审核</option><option value="POLL">完成活动投票</option><option value="TEST">完成活动测试</option><option value="ADMIN_REVIEW">管理员确认有效参与</option></select></label><Toggle label="固定奖励申请需要管理员审核" value={program.fixedReward.requiresReview} onChange={(value) => fixed({ requiresReview: value })} /><p className="text-xs">选择管理员确认时始终需要人工审核。</p><div className="grid gap-2 sm:grid-cols-2"><Field label="领取开始（北京时间）" type="datetime-local" value={localTime(program.fixedReward.startsAt)} onChange={(value) => fixed({ startsAt: value || null })} /><Field label="领取截止（北京时间）" type="datetime-local" value={localTime(program.fixedReward.endsAt)} onChange={(value) => fixed({ endsAt: value || null })} /></div></Group>
      <Group title="限定勋章"><Toggle label="启用限定勋章" value={program.medal.enabled} onChange={(value) => medal({ enabled: value })} /><label className="text-sm">绑定勋章<select className={inputClass} value={program.medal.badgeId || ''} onChange={(event) => medal({ badgeId: event.target.value || null })}><option value="">请选择</option>{badges.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{badge?.iconUrl ? <img src={badge.iconUrl} alt={badge.name} className="h-16 w-16 object-contain" /> : null}<TextArea label="勋章说明" value={program.medal.description} onChange={(value) => medal({ description: value })} /><div className="grid gap-2 sm:grid-cols-2">{([['PLATFORM', '平台任务审核通过'], ['APPROVED_COMMENT', '站内参与评论通过'], ['POLL', '完成投票'], ['TEST', '完成测试']] as const).map(([trigger, label]) => <Toggle key={trigger} label={label} value={program.medal.triggers.includes(trigger)} onChange={(value) => medal({ triggers: value ? [...program.medal.triggers, trigger] : program.medal.triggers.filter((item) => item !== trigger) })} />)}</div><Toggle label="有效期内参与、结束后审核仍允许补发" value={program.medal.allowLateReview} onChange={(value) => medal({ allowLateReview: value })} /></Group>
      <Group title="投票"><Toggle label="启用投票" value={program.poll.enabled} onChange={(value) => poll({ enabled: value })} /><Field label="投票标题" value={program.poll.title} onChange={(value) => poll({ title: value })} /><TextArea label="投票说明" value={program.poll.description} onChange={(value) => poll({ description: value })} /><div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">模式<select className={inputClass} value={program.poll.mode} onChange={(event) => poll({ mode: event.target.value as 'SINGLE' | 'MULTI', maxChoices: event.target.value === 'SINGLE' ? 1 : Math.max(2, program.poll.maxChoices) })}><option value="SINGLE">单选</option><option value="MULTI">多选</option></select></label><Field label="多选上限" type="number" value={program.poll.maxChoices} onChange={(value) => poll({ maxChoices: Number(value) })} /><Field label="开始（北京时间）" type="datetime-local" value={localTime(program.poll.startsAt)} onChange={(value) => poll({ startsAt: value || null })} /><Field label="截止（北京时间）" type="datetime-local" value={localTime(program.poll.endsAt)} onChange={(value) => poll({ endsAt: value || null })} /></div>{program.poll.options.map((option, index) => <div key={option.id} className="flex gap-2"><Field label={'选项 ' + (index + 1)} value={option.label} onChange={(value) => poll({ options: program.poll.options.map((item) => item.id === option.id ? { ...item, label: value } : item) })} /><button type="button" className={buttonClass} onClick={() => poll({ options: program.poll.options.filter((item) => item.id !== option.id) })}>移除</button></div>)}<button type="button" className={buttonClass} onClick={() => poll({ options: [...program.poll.options, { id: uid('poll-option'), label: '' }] })}>+ 添加选项</button><Toggle label="允许修改投票" value={program.poll.allowChange} onChange={(value) => poll({ allowChange: value })} /><Toggle label="显示实时结果" value={program.poll.showLiveResults} onChange={(value) => poll({ showLiveResults: value })} /><Toggle label="截止后公开结果" value={program.poll.publishAfterClose} onChange={(value) => poll({ publishAfterClose: value })} /><details className="text-xs"><summary>投票身份</summary><p>{program.poll.id} · 版本 {program.poll.version}</p><button type="button" className={buttonClass} onClick={() => poll({ id: uid('poll'), version: 1 })}>创建新投票身份，保留旧投票</button></details></Group>
      <Group title="活动测试"><Toggle label="启用测试" value={program.test.enabled} onChange={(value) => test({ enabled: value })} /><Field label="测试标题" value={program.test.title} onChange={(value) => test({ title: value })} /><TextArea label="测试说明" value={program.test.description} onChange={(value) => test({ description: value })} /><label className="text-sm">测试模式<select className={inputClass} value={program.test.mode} onChange={(event) => changeTestMode(event.target.value as 'KNOWLEDGE' | 'PERSONALITY')}><option value="KNOWLEDGE">知识测试</option><option value="PERSONALITY">趣味测试</option></select></label><Toggle label="允许重新测试" value={program.test.allowRetake} onChange={(value) => test({ allowRetake: value })} />
        {program.test.mode === 'PERSONALITY' ? <label className="text-sm">结果评分方式<select className={inputClass} value={program.test.scoringMode || 'LEGACY_WEIGHTED'} onChange={(event) => changeScoringMode(event.target.value as NonNullable<TopicActivityV2Program['test']['scoringMode']>)}><option value="RESULT_WEIGHT_ROLES_V1">主要 +4、次要 +2、弱关联 +1（推荐）</option><option value="LEGACY_WEIGHTED">旧版自定义权重（兼容历史活动）</option></select></label> : null}
        {program.test.questions.map((question, index) => <Group key={question.id} title={'题目 ' + (index + 1)}><Field label="题干" value={question.prompt} onChange={(value) => questionAt(index, { prompt: value })} />{program.test.mode === 'KNOWLEDGE' ? <Field label="答对得分" type="number" value={question.points} onChange={(value) => questionAt(index, { points: Number(value) })} /> : program.test.scoringMode === 'RESULT_WEIGHT_ROLES_V1' ? <details className="text-sm"><summary>高级设置 · 题目权重 {question.questionWeight ?? 1}</summary><Field label="题目权重（普通测试建议为 1）" type="number" value={question.questionWeight ?? 1} onChange={(value) => questionAt(index, { questionWeight: Number(value) })} /></details> : null}{question.options.map((option, optionIndex) => <div key={option.id} className="space-y-2 border border-[var(--border)] p-2"><Field label={'选项 ' + (optionIndex + 1)} value={option.label} onChange={(value) => questionAt(index, { options: question.options.map((item) => item.id === option.id ? { ...item, label: value } : item) })} />{program.test.mode === 'PERSONALITY' ? program.test.scoringMode === 'RESULT_WEIGHT_ROLES_V1' ? <TopicActivityResultWeightRoles results={program.test.results} weights={option.weights} onChange={(weights) => questionAt(index, { options: question.options.map((item) => item.id === option.id ? { ...item, weights } : item) })} /> : <div className="grid gap-2 sm:grid-cols-2">{program.test.results.map((result) => <Field key={result.id} label={(result.title || '未命名结果') + ' 旧版权重'} type="number" value={option.weights?.[result.id] || 0} onChange={(value) => questionAt(index, { options: question.options.map((item) => item.id === option.id ? { ...item, weights: { ...item.weights, [result.id]: Number(value) } } : item) })} />)}</div> : <label className="flex items-center gap-2 text-sm"><input type="radio" name={'correct-' + question.id} checked={question.correctOptionId === option.id} onChange={() => questionAt(index, { correctOptionId: option.id })} />正确答案</label>}<button type="button" className={buttonClass} onClick={() => questionAt(index, { options: question.options.filter((item) => item.id !== option.id), correctOptionId: question.correctOptionId === option.id ? undefined : question.correctOptionId })}>移除此选项</button></div>)}<div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => questionAt(index, { options: [...question.options, { id: uid('test-option'), label: '', ...(program.test.mode === 'PERSONALITY' && program.test.scoringMode === 'RESULT_WEIGHT_ROLES_V1' && program.test.results[0] ? { weights: { [program.test.results[0].id]: 4 } } : {}) }] })}>+ 添加选项</button><button type="button" className={buttonClass} onClick={() => test({ questions: program.test.questions.filter((item) => item.id !== question.id) })}>移除此题</button></div></Group>)}
        <button type="button" className={buttonClass} onClick={addTestQuestion}>+ 添加题目</button>
        <p className="text-xs text-[var(--foreground-muted)]">结果用于测试最终匹配。请先创建结果，再到每道题的选项中配置对应权重。</p>{resultDeleteError ? <p role="alert" className="text-sm text-[var(--danger)]">{resultDeleteError}</p> : null}
        {program.test.results.map((result, index) => <Group key={result.id} title={'结果 ' + (index + 1)}><Field label="结果标题" value={result.title} onChange={(value) => test({ results: program.test.results.map((item) => item.id === result.id ? { ...item, title: value } : item) })} /><TopicActivityResultDescriptions result={result} onChange={(value) => test({ results: program.test.results.map((item) => item.id === result.id ? { ...item, ...value } : item) })} />
          {program.test.mode === 'KNOWLEDGE' ? <div className="grid gap-2 sm:grid-cols-2"><Field label="最低分（包含）" type="number" value={result.scoreMin ?? 0} onChange={(value) => test({ results: program.test.results.map((item) => item.id === result.id ? { ...item, scoreMin: Number(value) } : item) })} /><Field label="最高分（包含）" type="number" value={result.scoreMax ?? 0} onChange={(value) => test({ results: program.test.results.map((item) => item.id === result.id ? { ...item, scoreMax: Number(value) } : item) })} /></div> : null}<button type="button" className={buttonClass} onClick={() => removeTestResult(result.id)}>移除此结果</button><p className="text-xs">结果 ID：{result.id}</p></Group>)}
        <button type="button" className={buttonClass} onClick={() => test({ results: [...program.test.results, { id: uid('result'), title: '', description: '', scoreMin: 0, scoreMax: 0 }] })}>+ 添加结果</button><p className="text-xs">知识测试分数区间必须覆盖全部分值且不重叠。趣味测试按权重求和，平分时使用配置中靠前的结果。</p>
        <details className="text-xs"><summary>测试版本</summary><p>{program.test.id} · 版本 {program.test.version}</p><p>已有答题记录时，修改测试内容会自动创建新版本，旧答题快照保留。</p></details>
      </Group>
      <Group title="分享海报设置"><TopicActivityPosterBackgroundUploader value={program.test.poster.backgroundUrl} disabled={disabled || saving || loading || posterUploading} onUploadingChange={(uploading) => imageUploading('poster-background', uploading)} onChange={(backgroundUrl) => test({ poster: { ...program.test.poster, backgroundUrl } })} /><p className="text-xs text-[var(--foreground-muted)]">旧活动未设置统一背景时，预览会暂用最早一张历史结果海报图；上传并保存统一背景后，所有结果都将使用这张图。</p><Toggle label="显示昵称" value={program.test.poster.showNickname} onChange={(value) => test({ poster: { ...program.test.poster, showNickname: value } })} /><Toggle label="显示活动二维码" value={program.test.poster.showQrCode} onChange={(value) => test({ poster: { ...program.test.poster, showQrCode: value } })} /><TopicActivityPosterPreview test={program.test} /></Group>
      {postId ? <a href={'/posts/' + encodeURIComponent(postId) + '?topicStatus=PENDING'} className="inline-block text-sm underline">前往活动主帖评论旁审核任务</a> : <p className="text-sm">活动发布后将沿用现有流程创建关联主帖。</p>}
      <button type="button" className={buttonClass} onClick={() => void save()} disabled={saving || loading || posterUploading}>{posterUploading ? '图片上传中…' : saving ? '保存中…' : '保存活动模块配置'}</button>
    </fieldset><TopicActivityV2LotteryAdmin activityId={activityId} disabled={disabled || saving || loading} entries={program.entries.map((entry) => ({ id: entry.id, platformName: entry.platformName, title: entry.title, enabled: entry.enabled, maxImages: entry.maxImages }))} /></>}{error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}
      {!loading ? <><TopicActivityV2FixedRewardReview activityId={activityId} disabled={disabled || saving} /><TopicActivityV2Statistics activityId={activityId} /></> : null}
    </div> : null}
  </section>
}
