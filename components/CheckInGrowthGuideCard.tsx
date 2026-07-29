export function CheckInGrowthGuideCard({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-br from-white to-sky-50/80 shadow-sm">
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 font-black text-brand-950 outline-none transition hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-brand-300 [&::-webkit-details-marker]:hidden ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}>
        <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true">🚑</span><span>了解经验值与挂号费</span></span>
        <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-100 text-base text-brand-700 transition-transform group-open:rotate-45">＋</span>
      </summary>

      <div className={`border-t border-sky-100 ${compact ? 'p-3' : 'p-4 sm:p-5'}`}>
        <h2 className="text-lg font-black text-brand-950 sm:text-xl">🚑 E院成长体系</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <GuideSection title="【经验值 EXP】">
            <p>经验值代表你在私家E院的成长历程。</p>
            <GuideList title="用途" items={['提升用户等级', '解锁成长称号', '展示用户活跃程度']} />
            <GuideList title="获取方式" items={['每日挂号', '社区互动', '完成任务', '官方活动']} />
          </GuideSection>

          <GuideSection title="【挂号费】">
            <p>挂号费是私家E院专属权益货币。</p>
            <GuideList title="未来用途" items={['活动报名', '福利兑换', '限定活动参与', '特殊权益开放', '未来可能开放香港名医预约玩法']} />
          </GuideSection>

          <GuideSection title="【如何获取挂号费】">
            <p><strong>每日挂号：</strong>每日首次签到随机获得 3～7 挂号费。</p>
            <GuideList title="其他普通来源" items={['每日任务：根据任务内容获得奖励', '完成社区互动：+1～3 挂号费', '发布帖子：+1～3 挂号费', '完成娱乐中心小游戏：+1～10 挂号费', '官方活动：根据活动规则发放']} />
          </GuideSection>

          <GuideSection title="【每日获取限制】">
            <p>每日普通挂号费最高 30 挂号费，包括每日挂号、普通任务、社区互动和娱乐奖励。</p>
            <p>达到 30 后，普通奖励停止增加，并于次日重新计算。</p>
          </GuideSection>

          <GuideSection title="【连续签到奖励】">
            <p>连续签到达到 7 天，解锁“长期患者奖励”；从第 7 天起，每日签到额外获得 +7 挂号费。</p>
            <p>这部分奖励不计入每日 30 挂号费限制。签到中断后需重新连续签到 7 天。</p>
          </GuideSection>

          <GuideSection title="【特别成就】">
            <p>连续签到 100 天可获得“百日病历”成就、徽章、专属称号和一次性挂号费奖励。</p>
          </GuideSection>
        </div>
      </div>
    </details>
  )
}

function GuideSection({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <section className="space-y-2 rounded-2xl border border-sky-100 bg-white/85 p-4 text-sm font-bold leading-6 text-slate-700"><h3 className="font-black text-brand-800">{title}</h3>{children}</section>
}

function GuideList({ title, items }: Readonly<{ title: string; items: string[] }>) {
  return <div><p className="text-xs font-black text-slate-500">{title}</p><ul className="mt-1 list-disc space-y-1 pl-5">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>
}
import type { ReactNode } from 'react'
