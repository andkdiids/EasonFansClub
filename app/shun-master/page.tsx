import { getSessionUserFromCookie } from '@/lib/auth'
import { ShunMasterClient } from './ShunMasterClient'

export const metadata = { title: '顺大师' }

export default async function ShunMasterPage({ searchParams }: { searchParams: Promise<{ record?: string; side?: string }> }) {
  const [{ record, side }, user] = await Promise.all([searchParams, getSessionUserFromCookie()])
  const focus = typeof record === 'string' && /^[a-z0-9]{1,40}$/.test(record) ? record : undefined
  return <ShunMasterClient key={JSON.stringify([!user, focus])} initialGuest={!user} focusedRecord={focus} initialSide={side === 'out' || !focus ? 'out' : 'in'} />
}
