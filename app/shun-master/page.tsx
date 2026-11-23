import { ShunMasterClient } from './ShunMasterClient'

export const metadata = { title: '顺大师' }

export default async function ShunMasterPage({ searchParams }: { searchParams: Promise<{ record?: string; side?: string }> }) {
  const { record, side } = await searchParams
  const focus = typeof record === 'string' && /^[a-z0-9]{1,40}$/.test(record) ? record : undefined
  return <ShunMasterClient key={focus || 'home'} focusedRecord={focus} initialSide={side === 'out' || !focus ? 'out' : 'in'} />
}
