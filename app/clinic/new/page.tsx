import { getCurrentUser } from '@/lib/auth'
import { ClinicComposer } from '@/components/clinic/ClinicComposer'

export const dynamic = 'force-dynamic'

export default async function NewClinicPage() {
  const user = await getCurrentUser().catch(() => null)
  return <ClinicComposer isAuthenticated={Boolean(user)} />
}
