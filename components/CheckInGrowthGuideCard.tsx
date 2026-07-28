export function CheckInGrowthGuideCard({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-br from-white to-sky-50/80 shadow-sm">
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-3 font-black text-brand-950 outline-none transition hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-brand-300 [&::-webkit-details-marker]:hidden ${
          compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true">🚑</span>
          <span>了解经验值与 E院积分</span>
        </span>
        <span
          aria-hidden="true"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-100 text-base text-brand-700 transition-transform group-open:rotate-45"
        >
          ＋
        </span>
      </summary>

      <div className={`border-t border-sky-100 ${compact ? 'p-3' : 'p-4 sm:p-5'}`}>
        <h2 className="text-lg font-black text-brand-950 sm:text-xl">🚑 E院成长体系</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <section className="rounded-2xl border border-sky-100 bg-white/85 p-4">
            <h3 className="font-black text-brand-800">【经验值 EXP】</h3>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-700">
              经验值代表用户在私家E院的活跃程度。
            </p>
            <p className="mt-3 text-xs font-black text-slate-500">目前用途</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm font-bold leading-6 text-slate-700">
              <li>记录用户成长历程</li>
              <li>展示用户活跃程度</li>
            </ul>
            <p className="mt-3 text-xs font-black text-slate-500">未来可能用于</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm font-bold leading-6 text-slate-700">
              <li>用户等级</li>
              <li>成长徽章</li>
              <li>社区身份展示</li>
              <li>更多功能解锁</li>
            </ul>
            <p className="mt-3 text-xs font-bold leading-5 text-slate-500">相关功能将随E院成长体系逐步扩展。</p>
          </section>

          <section className="rounded-2xl border border-sky-100 bg-white/85 p-4">
            <h3 className="font-black text-brand-800">【E院积分】</h3>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-700">积分用于未来参与E院活动。</p>
            <p className="mt-3 text-xs font-black text-slate-500">未来如举办</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm font-bold leading-6 text-slate-700">
              <li>粉丝福利活动</li>
              <li>线下活动</li>
              <li>特别活动</li>
              <li>周边活动</li>
            </ul>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-700">部分活动可能需要消耗一定积分。</p>
          </section>

          <section className="rounded-2xl border border-sky-100 bg-white/85 p-4">
            <h3 className="font-black text-brand-800">【积分获取方式】</h3>
            <p className="mt-2 text-xs font-black text-slate-500">积分获取方式</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm font-bold leading-6 text-slate-700">
              <li>每日挂号</li>
              <li>社区互动</li>
              <li>完成任务</li>
              <li>官方活动</li>
            </ul>
            <p className="mt-3 text-xs font-bold leading-5 text-slate-500">具体规则以后开放。</p>
          </section>
        </div>
      </div>
    </details>
  )
}
