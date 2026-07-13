import { NextResponse } from 'next/server'
import { getRegistrationPolicy } from '@/lib/registration'

export async function GET() {
  const policy = await getRegistrationPolicy()
  return NextResponse.json(
    {
      allowRegister: policy.allowRegister,
      registrationMode: policy.registrationMode,
      registrationModeLabel: policy.registrationModeLabel,
      allowPhoneRegistration: policy.allowPhoneRegistration,
      allowEmailRegistration: policy.allowEmailRegistration,
      registrationClosed: policy.registrationClosed,
      enableTurnstile: policy.enableTurnstile,
      turnstileSiteKey: policy.enableTurnstile ? policy.turnstileSiteKey : '',
      envForcedClosed: policy.envForcedClosed,
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
