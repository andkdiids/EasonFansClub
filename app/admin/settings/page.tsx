import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { getRegistrationPolicy } from '@/lib/registration'
import { RegistrationSettingsForm } from './RegistrationSettingsForm'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const user = await requireAdminPage('/admin/settings', 'site_config_manage')
  const policy = await getRegistrationPolicy()

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-4xl space-y-6 px-5 py-8">
        <RegistrationSettingsForm
          initialPolicy={{
            allowRegister: policy.allowRegister,
            registrationMode: policy.registrationMode,
            registrationModeLabel: policy.registrationModeLabel,
            allowPhoneRegistration: policy.allowPhoneRegistration,
            allowEmailRegistration: policy.allowEmailRegistration,
            registrationClosed: policy.registrationClosed,
            enableTurnstile: policy.enableTurnstile,
            envForcedClosed: policy.envForcedClosed,
          }}
        />
      </main>
    </>
  )
}
