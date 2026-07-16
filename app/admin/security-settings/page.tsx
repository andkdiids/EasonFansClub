import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { SecuritySettingsForm } from './SecuritySettingsForm'

export const dynamic = 'force-dynamic'

export default async function AdminSecuritySettingsPage() {
  const user = await requireAdminPage('/admin/security-settings', 'account_security_manage')
  const settings = await getAccountSecuritySettings()
  return <><SiteHeader user={user} /><main className="mx-auto max-w-4xl px-5 py-8"><h1 className="text-3xl font-black text-brand-950">账号安全设置</h1><p className="mt-3 mb-6 text-sm font-bold text-slate-600">配置修改后立即影响注册与密码找回接口，并记录管理员操作日志。</p><SecuritySettingsForm initial={settings} /></main></>
}
