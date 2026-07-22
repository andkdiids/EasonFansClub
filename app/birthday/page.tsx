import Link from 'next/link'
import { redirect } from 'next/navigation'
import { HeroBackground } from '@/components/HeroBackground'
import { getCurrentUser } from '@/lib/auth'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function BirthdaySupportPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fbirthday')
  const config = await getSiteAppearance()
  const visual = config.heroVisuals.birthday
  return <main className="site-page-main flat-page mx-auto max-w-7xl px-4 py-8 sm:px-5"><section className="relative isolate grid min-h-[560px] overflow-hidden border border-slate-800 bg-[#071523] text-white shadow-[0_20px_70px_rgba(2,12,27,.2)]"><HeroBackground visual={visual} fallbackImageUrl={config.images.activityCoverUrl} priority /><div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-black/10" /><div className="relative z-10 flex max-w-2xl flex-col items-start justify-end p-8 sm:p-12"><p className="text-xs font-black uppercase tracking-[.28em] text-sky-200/80">Birthday Support Project</p><h1 className="mt-4 text-5xl font-black tracking-tight sm:text-7xl">生日应援</h1><p className="mt-5 text-base font-bold leading-8 text-white/78">把祝福、作品与共同记忆留在这里。专题内容上线前，视觉图片与桌面、移动裁剪位置均可在后台独立维护。</p><Link href="/activities" className="mt-7 border border-white/30 bg-black/20 px-5 py-3 text-sm font-black text-white">返回活动中心</Link></div></section></main>
}
