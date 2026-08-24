import { requireAdminPage } from '@/components/AdminAccess'
import { MaterialRedemptionAdminManager } from '../MaterialRedemptionAdminManager'

export const dynamic = 'force-dynamic'

export default async function MaterialRedemptionVerifyPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const params = await searchParams
  const token = typeof params.token === 'string' ? params.token : ''
  const path = token ? `/admin/material-redemptions/verify?token=${encodeURIComponent(token)}` : '/admin/material-redemptions/verify'
  await requireAdminPage(path, 'material_redemption_manage')
  return <main className="mx-auto min-w-0 max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-9"><section className="border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8"><p className="text-sm font-black tracking-[0.18em] text-brand-700">管理后台</p><h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">现场核销</h1><p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">扫码或输入兑换码后，请先查看订单，再手动确认交付。二维码不会自动核销。</p></section><MaterialRedemptionAdminManager initialTab="verify" initialVerifyToken={token} /></main>
}
