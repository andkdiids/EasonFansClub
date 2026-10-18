import type { TopicActivityWizardDraft } from './TopicActivityWizardState'
import { parseActivityDateInput } from '@/lib/activity'
import { formatBeijingDateTimeInput } from '@/lib/registration-availability'

function displayDate(value: string | null | undefined) {
  if (!value) return '未填写'
  const parsed = parseActivityDateInput(value)
  return parsed ? formatBeijingDateTimeInput(parsed)?.replace('T', ' ') || value.replace('T', ' ') : value.replace('T', ' ')
}

export function TopicActivityWizardSummary({ draft, coverName, badgeName }: {
  draft: TopicActivityWizardDraft; coverName?: string; badgeName?: string
}) {
  const { activity, program, lottery } = draft
  return <div className="space-y-4 text-sm">
    <section className="space-y-2 border border-[var(--border)] p-4"><h3 className="font-bold">活动信息</h3>
      <p>名称：{activity.title || '未填写'}</p><p className="whitespace-pre-wrap break-words">介绍：{activity.description || '未填写'}</p>
      <p>封面：{coverName || (activity.coverUrl ? '已设置' : '未选择')}</p><p>活动时间：{displayDate(activity.startsAt)} 至 {displayDate(activity.endsAt)}（北京时间）</p>
    </section>
    <section className="space-y-2 border border-[var(--border)] p-4"><h3 className="font-bold">参与规则</h3>
      <p className="whitespace-pre-wrap break-words">{activity.participationRule || '未填写'}</p>
      <p>评论需人工审核 · 图片附件{activity.allowImageAttachments ? '开启' : '关闭'} · 允许多次参与评论</p>
      {program.entries.some((entry) => entry.enabled) ? <ul className="space-y-2">{program.entries.filter((entry) => entry.enabled).map((entry) => <li key={entry.id} className="break-words">
        {entry.platformName}：{entry.title} · 截图 {entry.minImages}～{entry.maxImages} 张 · 每入口审核通过奖励 {entry.points} 挂号费
        {entry.instructions ? <p className="whitespace-pre-wrap text-[var(--foreground-muted)]">补充要求：{entry.instructions}</p> : null}
      </li>)}</ul> : <p>未配置平台任务，仅站内话题参与。</p>}
    </section>
    <section className="space-y-2 border border-[var(--border)] p-4"><h3 className="font-bold">参与奖励</h3>
      <p>平台挂号费按任务独立发放，与抽奖次数无关。</p>
      <p>发奖安排：{activity.rewardGrantMode === 'SCHEDULED' ? `${displayDate(activity.rewardGrantAt)}（北京时间）统一发放` : '审核通过后立即发放'}</p>
      <p>勋章：{program.medal.enabled ? badgeName || '未选择' : '未开启'}{program.medal.enabled ? ` · ${program.medal.triggers.includes('PLATFORM') ? '平台任务' : '站内参与评论'}审核通过触发` : ''}</p>
      <p>测试题：{program.test.enabled ? `已启用 · ${program.test.mode === 'KNOWLEDGE' ? '知识测试' : '趣味测试'} · ${program.test.questions.length} 道题 · ${program.test.results.length} 个结果` : '未启用'}</p>
      <p>固定奖励与投票：按现有配置保留，不在此步骤修改。</p>
    </section>
    <section className="space-y-2 border border-[var(--border)] p-4"><h3 className="font-bold">话题活动扩展：抽奖</h3>
      {lottery.enabled ? <>
        <p>资格来源：{program.entries.filter((entry) => lottery.sourceEntryIds.includes(entry.id)).map((entry) => entry.platformName).join('、') || '未选择'}的有效截图任务审核通过。</p>
        <p>每人本活动最多获得一次资格；普通讨论评论不会直接获得抽奖资格。</p>
        <ul className="space-y-2">{lottery.prizes.map((prize) => <li key={prize.id}>{prize.name || '未命名奖品'} × {prize.quantity}{prize.description ? <p className="whitespace-pre-wrap text-[var(--foreground-muted)]">{prize.description}</p> : null}{prize.imageUrl ? <p>已设置奖品图片</p> : null}</li>)}</ul>
        <p>总库存：{lottery.prizes.reduce((count, prize) => count + prize.quantity, 0)} 件</p>
        <p>资格截止：{displayDate(lottery.eligibilityDeadline) === '未填写' ? '同活动结束时间' : displayDate(lottery.eligibilityDeadline)}（北京时间）</p>
        <p>开奖：{displayDate(lottery.drawAt)}（北京时间） · {lottery.mode === 'MANUAL' ? '管理员确认开奖' : '到时自动开奖，仍受服务端安全条件限制'}</p>
        <p>收件截止：{displayDate(lottery.addressDeadline)}（北京时间）</p>
        <p>中奖名单：默认不公开 · 收件信息保留策略：{lottery.retentionDays} 天</p>
      </> : <p>未开启抽奖。话题活动可独立运营。</p>}
    </section>
  </div>
}
