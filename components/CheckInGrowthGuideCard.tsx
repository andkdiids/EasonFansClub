import type { ReactNode } from 'react'

export function CheckInGrowthGuideCard({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <details className="group overflow-hidden rounded-sm border border-sky-200 bg-gradient-to-br from-white to-sky-50/80 shadow-sm">
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 font-black text-brand-950 outline-none transition hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-brand-300 [&::-webkit-details-marker]:hidden ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}>
        <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true">🏥</span><span>了解经验值与挂号费</span></span>
        <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-sky-100 text-base text-brand-700 transition-transform group-open:rotate-45">＋</span>
      </summary>

      <div className={`border-t border-sky-200 ${compact ? 'p-3' : 'p-4 sm:p-5'}`}>
        <div className="border-l-4 border-brand-700 bg-white px-4 py-3">
          <h2 className="text-lg font-black text-brand-950 sm:text-xl">🏥 挂号费获取指南</h2>
          <p className="mt-1 text-xs font-bold text-slate-500 sm:text-sm">经验值记录成长，挂号费用于权益，两套资源独立计算。</p>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <GuideSection eyebrow="成长档案" title="经验值 EXP">
            <p>经验值代表你在私家E院的成长等级。</p>
            <GuideList title="用途" items={['提升等级', '解锁成长称号', '展示用户活跃程度']} />
          </GuideSection>

          <GuideSection eyebrow="权益资源" title="什么是挂号费">
            <p>挂号费是私家E院专属权益资源。</p>
            <GuideList title="未来可用于" items={['粉丝活动报名', '限定福利兑换', '特殊权益解锁', '娱乐天空玩法', '未来可能开放香港名医预约等特色玩法']} />
          </GuideSection>
        </div>

        <div className="mt-4 border border-blue-200 bg-blue-50 px-4 py-3 text-center text-sm font-black text-brand-950">
          经验值 EXP ≠ 挂号费：经验值决定成长等级，挂号费代表可使用的权益资源。
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <GuideSection eyebrow="每日奖励" title="如何获取挂号费">
            <GuideFact label="每日挂号" value="每日首次完成挂号，获得 3～7 挂号费。" />
            <GuideFact label="连续挂号奖励" value="连续挂号达到 7 天后解锁“长期患者奖励”，之后每日额外获得 +7 挂号费。" />
            <p className="border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">连续挂号额外奖励独立计算，不占用每日 30 挂号费获取上限；中断后需重新连续挂号 7 天。</p>
          </GuideSection>

          <GuideSection eyebrow="更多途径" title="其他获取方式">
            <GuideList items={[
              '每日任务：根据任务内容获得挂号费',
              '社区互动：参与社区活动获得挂号费奖励',
              '娱乐天空：参与猜歌、小游戏等玩法获得挂号费',
              '官方活动：根据活动规则发放',
            ]} />
            <p className="text-xs text-slate-500">具体奖励以任务页面和活动页面显示为准。</p>
          </GuideSection>

          <GuideSection eyebrow="每日额度" title="每日获取限制" wide>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="grid min-h-28 place-items-center border border-sky-200 bg-sky-50 p-4 text-center">
                <span>
                  <span className="block text-xs font-black text-slate-500">每日普通获取上限</span>
                  <strong className="mt-1 block text-3xl font-black text-brand-950">30</strong>
                  <span className="text-xs font-black text-brand-700">挂号费</span>
                </span>
              </div>
              <div>
                <GuideList title="计算范围" items={['每日签到奖励', '每日任务', '社区互动', '娱乐天空普通奖励']} />
                <p className="mt-2">普通奖励达到 30 后不再增加；连续挂号额外奖励不受该上限影响。</p>
              </div>
            </div>
            <FeeExample />
          </GuideSection>

          <GuideSection eyebrow="长期档案" title="特别成就" wide>
            <p>连续挂号 100 天，可获得“百日病历”成就、徽章、专属称号和一次性挂号费奖励。</p>
          </GuideSection>
        </div>
      </div>
    </details>
  )
}

function GuideSection({ eyebrow, title, children, wide = false }: Readonly<{ eyebrow: string; title: string; children: ReactNode; wide?: boolean }>) {
  return (
    <section className={`space-y-3 rounded-sm border border-sky-100 bg-white/90 p-4 text-sm font-bold leading-6 text-slate-700 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="border-b border-sky-100 pb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-600">{eyebrow}</p>
        <h3 className="mt-0.5 font-black text-brand-950">【{title}】</h3>
      </div>
      {children}
    </section>
  )
}

function GuideFact({ label, value }: Readonly<{ label: string; value: string }>) {
  return <p><strong className="text-brand-800">{label}：</strong>{value}</p>
}

function GuideList({ title, items }: Readonly<{ title?: string; items: string[] }>) {
  return <div>{title ? <p className="text-xs font-black text-slate-500">{title}</p> : null}<ul className="mt-1 list-disc space-y-1 pl-5">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>
}

function FeeExample() {
  const items = [
    ['签到', '5'],
    ['任务', '15'],
    ['娱乐', '10'],
    ['普通获取', '30'],
    ['连续挂号奖励', '+7'],
    ['今日实际获得', '37 挂号费'],
  ]

  return (
    <div className="border-t border-sky-100 pt-3">
      <p className="text-xs font-black text-slate-500">计算示例</p>
      <div className="mt-2 grid grid-cols-2 gap-px border border-sky-100 bg-sky-100 sm:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="bg-sky-50 px-3 py-2">
            <span className="block text-xs font-bold text-slate-500">{label}</span>
            <strong className="text-brand-950">{value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
