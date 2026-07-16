import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SiteHeader } from '@/components/SiteHeader'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type BadgeTone = 'green' | 'orange' | 'gray' | 'blue'

const badgeClasses: Record<BadgeTone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  orange: 'bg-amber-50 text-amber-700 ring-amber-100',
  gray: 'bg-slate-100 text-slate-600 ring-slate-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-100',
}

function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ${badgeClasses[tone]}`}>{label}</span>
}

export default async function SecurityPage() {
  const session = await getCurrentUser()
  if (!session) redirect('/login?redirect=%2Fsettings%2Fsecurity')

  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.id },
      select: {
        email: true,
        emailVerifiedAt: true,
        securityQuestionRecoveryEnabled: true,
        _count: { select: { securityQuestions: true } },
      },
    }),
    getAccountSecuritySettings(),
  ])
  if (!user) redirect('/login')

  const questionsSet = user._count.securityQuestions === 3
  const recoveryReason = !settings.enableSecurityQuestionRecovery
    ? '系统功能已关闭'
    : !questionsSet
      ? '未设置密保'
      : !user.securityQuestionRecoveryEnabled
        ? '账号功能已停用'
        : '已启用'

  const rows: { label: string; detail?: string; value: string; tone: BadgeTone }[] = [
    { label: '密保问题', detail: questionsSet ? '不可修改' : undefined, value: questionsSet ? '已设置' : '未设置', tone: questionsSet ? 'green' : 'gray' },
    { label: '密保问题找回', detail: recoveryReason === '已启用' ? undefined : recoveryReason, value: recoveryReason === '已启用' ? '已启用' : '已停用', tone: recoveryReason === '已启用' ? 'green' : 'orange' },
    { label: '邮箱', value: user.email ? '已绑定' : '未绑定', tone: user.email ? 'green' : 'gray' },
    { label: '邮箱验证', value: user.emailVerifiedAt ? '已验证' : '未验证', tone: user.emailVerifiedAt ? 'green' : 'orange' },
    { label: '邮箱重置功能', value: settings.enableEmailPasswordReset ? '已开放' : '暂未开放', tone: settings.enableEmailPasswordReset ? 'green' : 'blue' },
  ]

  return (
    <>
      <SiteHeader user={session} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <section className="rounded-[32px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Account Recovery</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">账号恢复方式</h1>
          <p className="mt-3 text-sm font-bold leading-7 text-slate-500">查看当前账号可用的恢复方式与验证状态。</p>

          <div className="mt-6 space-y-3">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 rounded-2xl border border-sky-100/80 bg-sky-50/45 px-4 py-4 sm:px-5">
                <div>
                  <p className="font-black text-brand-950">{row.label}</p>
                  {row.detail ? <p className="mt-1 text-xs font-bold text-slate-500">{row.detail}</p> : null}
                </div>
                <StatusBadge label={row.value} tone={row.tone} />
              </div>
            ))}
          </div>

          {!questionsSet ? (
            <Link href="/settings/security-questions" className="mt-5 inline-flex rounded-full bg-brand-700 px-5 py-3 text-sm font-black text-white shadow-sm">
              立即设置密保问题
            </Link>
          ) : null}

          {!settings.enableEmailPasswordReset ? (
            <p className="mt-5 rounded-2xl bg-sky-50 px-4 py-3 text-sm font-black text-sky-700">邮箱重置功能暂未开放。</p>
          ) : null}

          <div className="mt-6 rounded-2xl border border-sky-100 bg-white px-4 py-4 text-sm font-bold leading-7 text-slate-600">
            <p>账号恢复方式由系统统一管理。</p>
            <p>如需调整密保找回方式，请联系管理员。</p>
          </div>
        </section>
      </main>
    </>
  )
}
