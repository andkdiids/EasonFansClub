import type { TopicActivityWizardDraft } from './TopicActivityWizardState'

export function TopicActivityWizardSummary({ draft, coverName, badgeName }: {
  draft: TopicActivityWizardDraft; coverName?: string; badgeName?: string
}) {
  const { activity, program, lottery } = draft
  return <div className="space-y-4 text-sm">
    <section className="space-y-2 border border-[var(--border)] p-4"><h3 className="font-bold">活动信息</h3>
      <p>名称：{activity.title || '未填写'}</p><p className="whitespace-pre-wrap break-words">介绍：{activity.description || '未填写'}</p>
      <p>封面：{coverName || '未选择'}</p><p>活动时间：{activity.startsAt?.replace('T', ' ') || '未填写'} 至 {activity.endsAt?.replace('T', ' ') || '未填写'}（北京时间）</p>
    </section>
    <section className="space-y-2 border border-[var(--border)] p-4"><h3 className="font-bold">参与规则</h3>
      <p className="whitespace-pre-wrap break-words">{activity.participationRule || '未填写'}</p>
      <p>评论需人工审核 · 图片附件{activity.allowImageAttachments ? '开启' : '关闭'} · 允许多次参与评论</p>
      {program.entries.length ? <ul className="space-y-2">{program.entries.map((entry) => <li key={entry.id} className="break-words">
        {entry.platformName}：{entry.title} · 截图 {entry.minImages}～{entry.maxImages} 张 · 每入口审核通过奖励 {entry.points} 挂号费
        {entry.instructions ? <p className="whitespace-pre-wrap text-[var(--foreground-muted)]">补充要求：{entry.instructions}</p> : null}
      </li>)}</ul> : <p>未配置平台任务，仅站内话题参与。</p>}
    </section>
    <section className="space-y-2 border border-[var(--border)] p-4"><h3 className="font-bold">参与奖励</h3>
      <p>平台挂号费按任务独立发放，与抽奖次数无关。</p>
      <p>勋章：{program.medal.enabled ? badgeName || '未选择' : '未开启'}{program.medal.enabled ? ` · ${program.medal.triggers.includes('PLATFORM') ? '平台任务' : '站内参与评论'}审核通过触发` : ''}</p>
      <p>固定奖励、投票、测试及海报未开启。</p>
    </section>
    <section className="space-y-2 border border-[var(--border)] p-4"><h3 className="font-bold">话题活动扩展：抽奖</h3>
      {lottery.enabled ? <>
        <p>资格来源：{program.entries.filter((entry) => lottery.sourceEntryIds.includes(entry.id)).map((entry) => entry.platformName).join('、') || '未选择'}的有效截图任务审核通过。</p>
        <p>每人本活动最多获得一次资格；普通讨论评论不会直接获得抽奖资格。</p>
        <ul>{lottery.prizes.map((prize) => <li key={prize.id}>{prize.name || '未命名奖品'} × {prize.quantity}</li>)}</ul>
        <p>总库存：{lottery.prizes.reduce((count, prize) => count + prize.quantity, 0)} 件</p>
        <p>资格截止：同活动结束时间</p>
        <p>开奖：{lottery.drawAt?.replace('T', ' ') || '未填写'}（北京时间） · {lottery.mode === 'MANUAL' ? '管理员确认开奖' : '到时自动开奖，仍受服务端安全条件限制'}</p>
        <p>收件截止：{lottery.addressDeadline?.replace('T', ' ') || '未填写'}（北京时间）</p>
        <p>中奖名单：默认不公开 · 收件信息保留策略：{lottery.retentionDays} 天</p>
      </> : <p>未开启抽奖。话题活动可独立运营。</p>}
    </section>
  </div>
}
