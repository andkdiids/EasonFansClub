import { getSessionUserFromCookie } from '@/lib/auth'
import { ShunMasterClient } from './ShunMasterClient'

export const metadata = { title: '顺大师' }

export default async function ShunMasterPage({ searchParams }: { searchParams: Promise<{ record?: string; side?: string; letter?: string }> }) {
  const [{ record, side, letter }, user] = await Promise.all([searchParams, getSessionUserFromCookie()])
  const focus = typeof record === 'string' && /^[a-z0-9]{1,40}$/.test(record) ? record : undefined
  // `letter=1` is the notification flag and targets the focused round; an explicit
  // letter id is also accepted. A flag without a target, or a malformed value, is
  // dropped here — the server still re-checks ownership before returning content.
  const autoLetterId = focus && letter === '1' ? focus
    : typeof letter === 'string' && letter !== '1' && /^[a-z0-9]{1,40}$/.test(letter) ? letter : undefined
  return <ShunMasterClient key={JSON.stringify([!user, focus, autoLetterId ?? null])} initialGuest={!user}
    focusedRecord={focus} initialSide={side === 'out' || !focus ? 'out' : 'in'} autoLetterId={autoLetterId} />
}
