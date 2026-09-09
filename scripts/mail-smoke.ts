import { config as loadDotenv } from 'dotenv'
import {
  sendEmailVerificationCode,
  sendPasswordResetCode,
  sendPasswordResetLinkEmail,
  TencentMailProviderError,
} from '../lib/mail'

loadDotenv({ quiet: true })

const recipient = process.env.MAIL_SMOKE_TEST_RECIPIENT?.trim()

if (!recipient) {
  console.error('MAIL_SMOKE_TEST_RECIPIENT is not set; no email was sent.')
  process.exit(2)
}

const checks: Array<{ name: string; run: () => Promise<unknown> }> = [
  {
    name: 'registration_code',
    run: () => sendEmailVerificationCode(recipient, '123456', 'register'),
  },
  {
    name: 'profile_email_code',
    run: () => sendEmailVerificationCode(recipient, '234567', 'change-email'),
  },
  {
    name: 'password_reset_code',
    run: () => sendPasswordResetCode(recipient, '345678'),
  },
  {
    name: 'password_reset_link',
    run: () => sendPasswordResetLinkEmail(recipient, 'https://ecfc.fans/reset-password?token=mail-smoke-invalid'),
  },
]

async function main() {
  let failed = false
  for (const check of checks) {
    try {
      const result = await check.run()
      if (!result || (result as { sent?: boolean }).sent !== true) {
        failed = true
        console.error(JSON.stringify({ check: check.name, status: 'FAIL', reason: 'provider_did_not_accept' }))
        continue
      }
      console.log(JSON.stringify({ check: check.name, status: 'PASS' }))
    } catch (error) {
      failed = true
      if (error instanceof TencentMailProviderError) {
        console.error(JSON.stringify({
          check: check.name,
          status: 'FAIL',
          providerCode: error.providerCode,
          providerRequestId: error.providerRequestId,
          httpStatus: error.httpStatus,
          attempt: error.attempt,
        }))
      } else {
        console.error(JSON.stringify({
          check: check.name,
          status: 'FAIL',
          errorType: error instanceof Error ? error.name : 'UNKNOWN',
          error: error instanceof Error ? error.message : 'unknown_error',
        }))
      }
    }
  }

  if (failed) process.exitCode = 1
}

void main()
