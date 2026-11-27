import { getSessionUserFromCookie } from '@/lib/auth'
import { ShunMasterClient } from './ShunMasterClient'

export const metadata = { title: '顺大师' }

export default async function ShunMasterPage({ searchParams }: { searchParams: Promise<{ record?: string; side?: string; letter?: string; captureLetter?: string; items?: string }> }) {
  const [{ record, side, letter, captureLetter, items }, user] = await Promise.all([searchParams, getSessionUserFromCookie()])
  const focus = typeof record === 'string' && /^[a-z0-9]{1,40}$/.test(record) ? record : undefined
  // `letter=1` is the notification flag and targets the focused round; an explicit
  // letter id is also accepted. A flag without a target, or a malformed value, is
  // dropped here — the server still re-checks ownership before returning content.
  const autoLetterId = focus && letter === '1' ? focus
    : typeof letter === 'string' && letter !== '1' && /^[a-z0-9]{1,40}$/.test(letter) ? letter : undefined
  // V5: the capture counter note uses its own one-shot flag on the same record.
  const autoCaptureLetterId = focus && captureLetter === '1' ? focus : undefined
  return <ShunMasterClient key={JSON.stringify([user?.id, focus, autoLetterId ?? null, autoCaptureLetterId ?? null, items === '1'])}
    sessionUserId={user?.id} initialItemsOpen={items === '1'} initialGuest={!user} focusedRecord={focus} initialSide={side === 'out' || !focus ? 'out' : 'in'}
    autoLetterId={autoLetterId} autoCaptureLetterId={autoCaptureLetterId} />
}
