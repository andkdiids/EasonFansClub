import { requireAdminPage } from '@/components/AdminAccess'
import { MaterialRedemptionAdminManager } from './MaterialRedemptionAdminManager'

export const dynamic = 'force-dynamic'

export default async function AdminMaterialRedemptionsPage() {
  await requireAdminPage('/admin/material-redemptions', 'material_redemption_manage')
  return <main className="mx-auto min-w-0 max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-9"><section className="border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8"><p className="text-sm font-black tracking-[0.18em] text-brand-700">管理后台</p><h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">还有什么可以送给你</h1><p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">维护限时物料、兑换资格、库存、订单核销和退款。暂停兑换不会影响已经成功取得的待核销订单。</p></section><MaterialRedemptionAdminManager /></main>
}
