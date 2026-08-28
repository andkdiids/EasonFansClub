import { redirect } from 'next/navigation'
import { UserPrivacySettingsForm } from '@/components/UserPrivacySettingsForm'
import { getCurrentUser } from '@/lib/auth'
import { DEFAULT_USER_PRIVACY_SETTINGS, getUserPrivacySettings } from '@/lib/user-privacy'

export const dynamic = 'force-dynamic'

export default async function PrivacySettingsPage() {
  const session = await getCurrentUser()
  if (!session) redirect('/login?redirect=%2Fsettings%2Fprivacy')

  let settings = DEFAULT_USER_PRIVACY_SETTINGS
  try {
    settings = await getUserPrivacySettings(session.id)
  } catch (error) {
    console.error('[user-privacy.page.read]', { userId: session.id, error })
  }

  return <main className="site-page-main flat-page mx-auto w-full max-w-7xl min-w-0 px-5 py-8">
    <section className="min-w-0 rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-8">
      <p className="text-sm font-black tracking-[0.18em] text-[var(--primary)]">个人主页</p>
      <h1 className="mt-2 break-words text-3xl font-black text-[var(--foreground)]">隐私设置</h1>
      <p className="mt-3 break-words text-sm font-bold leading-7 text-[var(--foreground-muted)]">控制其他用户访问你的个人主页时可以看到哪些内容。</p>
      <UserPrivacySettingsForm initialSettings={settings} />
    </section>
  </main>
}
