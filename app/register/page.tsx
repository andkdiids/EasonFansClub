import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getRegistrationPolicy } from '@/lib/registration'
import { getSiteAppearance } from '@/lib/site-config'
import { RegisterForm } from './RegisterForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function RegisterPage() {
  const [config, policy] = await Promise.all([getSiteAppearance(), getRegistrationPolicy()])

  return (
    <AuthFormShell
      title="创建账号"
      subtitle={config.text.registerHint}
      siteName={config.text.siteName}
      backgroundUrl={config.images.registerBackgroundUrl}
      logoUrl={config.images.navLogoUrl || config.images.logoUrl}
      footer={
        <>
          已经有账号？{' '}
          <Link href="/login" className="font-black text-brand-700">
            去登录
          </Link>
        </>
      }
    >
      <RegisterForm
        policy={{
          allowRegister: policy.allowRegister,
          registrationMode: policy.registrationMode,
          registrationModeLabel: policy.registrationModeLabel,
          allowPhoneRegistration: policy.allowPhoneRegistration,
          allowEmailRegistration: policy.allowEmailRegistration,
          registrationClosed: policy.registrationClosed,
          enableTurnstile: policy.enableTurnstile,
          turnstileSiteKey: policy.turnstileSiteKey,
          envForcedClosed: policy.envForcedClosed,
          requireSecurityQuestionsForNewUsers: policy.requireSecurityQuestionsForNewUsers,
        }}
      />
    </AuthFormShell>
  )
}
