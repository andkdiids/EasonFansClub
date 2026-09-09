import { createHash, createHmac } from 'node:crypto'
import {
  EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES,
  renderEmailVerificationCode,
  renderEmailVerificationLink,
  PASSWORD_RESET_CODE_EXPIRY_MINUTES,
  renderPasswordResetEmail,
} from '@/lib/password-reset-email'

type MailTemplateInput = {
  title: string
  intro: string
  actionText: string
  actionUrl: string
  note?: string
}

export type SendMailResult =
  | { sent: true }
  | { sent: false; reason: 'missing_tencent_email_config' }

export type MailType =
  | 'registration_code'
  | 'profile_email_code'
  | 'verification_link'
  | 'password_reset_code'
  | 'password_reset_link'

type MailAttempt = 'simple' | 'template'

export class TencentMailProviderError extends Error {
  readonly provider = 'tencent-ses'
  readonly providerCode: string
  readonly providerMessage: string
  readonly providerRequestId: string | null
  readonly httpStatus: number | null
  readonly attempt: MailAttempt

  constructor({
    code,
    message,
    requestId,
    httpStatus,
    attempt,
  }: {
    code: string
    message: string
    requestId?: string | null
    httpStatus?: number | null
    attempt: MailAttempt
  }) {
    super(`TENCENT_EMAIL_SEND_FAILED:${code}:${message}`.slice(0, 320))
    this.name = 'TencentMailProviderError'
    this.providerCode = code
    this.providerMessage = message
    this.providerRequestId = requestId || null
    this.httpStatus = httpStatus ?? null
    this.attempt = attempt
  }
}

function safeProviderMessage(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted-token]')
    .slice(0, 240)
}

function providerFailureDetails(error: unknown) {
  if (error instanceof TencentMailProviderError) {
    return {
      errorType: error.name,
      providerCode: error.providerCode,
      providerMessage: safeProviderMessage(error.providerMessage),
      providerRequestId: error.providerRequestId,
      httpStatus: error.httpStatus,
      attempt: error.attempt,
    }
  }

  return {
    errorType: error instanceof Error ? error.name : 'UNKNOWN',
    providerCode: error instanceof Error && error.message.includes('NOT_CONFIGURED') ? 'CONFIGURATION' : 'UNKNOWN',
    providerMessage: error instanceof Error ? safeProviderMessage(error.message) : 'unknown_error',
    providerRequestId: null,
    httpStatus: null,
    attempt: null,
  }
}

export function isMailFailure(error: unknown) {
  return error instanceof TencentMailProviderError || (error instanceof Error && /(?:TENCENT_EMAIL|EMAIL_SEND)/.test(error.message))
}

export function logMailFailure(error: unknown, context: { route: string; mailType: MailType }) {
  console.error('[mail.send.failed]', {
    event: 'mail.send.failed',
    provider: 'tencent-ses',
    route: context.route,
    mailType: context.mailType,
    timestamp: new Date().toISOString(),
    ...providerFailureDetails(error),
  })
}

const tencentEmailHost = 'ses.tencentcloudapi.com'
const tencentEmailService = 'ses'
const tencentEmailVersion = '2020-10-02'

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest()
}

function getTencentEmailConfig() {
  return {
    secretId:
      process.env.TENCENT_EMAIL_SECRET_ID ||
      process.env.TENCENT_SECRET_ID ||
      process.env.TENCENT_COS_SECRET_ID ||
      '',

    secretKey:
      process.env.TENCENT_EMAIL_SECRET_KEY ||
      process.env.TENCENT_SECRET_KEY ||
      process.env.TENCENT_COS_SECRET_KEY ||
      '',

    region:
      process.env.TENCENT_EMAIL_REGION ||
      process.env.TENCENT_COS_REGION ||
      'ap-guangzhou',

    from:
      process.env.TENCENT_EMAIL_FROM ||
      '0727@ecfc.fans',
  }
}


function buildTencentAuthorization({
  secretId,
  secretKey,
  payload,
  timestamp,
}: {
  secretId: string
  secretKey: string
  payload: string
  timestamp: number
}) {
  const method = 'POST'
  const canonicalUri = '/'
  const canonicalQueryString = ''

  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\n` +
    `host:${tencentEmailHost}\n`

  const signedHeaders = 'content-type;host'

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    sha256(payload),
  ].join('\n')


  const date = new Date(timestamp * 1000)
    .toISOString()
    .slice(0, 10)


  const credentialScope =
    `${date}/${tencentEmailService}/tc3_request`


  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')


  const secretDate =
    hmac(`TC3${secretKey}`, date)

  const secretService =
    hmac(secretDate, tencentEmailService)

  const secretSigning =
    hmac(secretService, 'tc3_request')


  const signature =
    createHmac('sha256', secretSigning)
      .update(stringToSign)
      .digest('hex')


  return (
    `TC3-HMAC-SHA256 ` +
    `Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`
  )
}


type TencentMailContent =
  | { Template: { TemplateID: number; TemplateData: string } }
  | { Simple: { Html: string; Text: string } }

async function sendTencentMail({
  to,
  subject,
  content,
  templateId,
  attempt,
}: {
  to: string
  subject: string
  content: TencentMailContent
  templateId?: number
  attempt: MailAttempt
}): Promise<SendMailResult> {
  const config = getTencentEmailConfig()
  const templateInvalid = templateId !== undefined && (!Number.isInteger(templateId) || templateId <= 0)
  if (!config.secretId || !config.secretKey || templateInvalid) {
    if (process.env.NODE_ENV === 'production') throw new Error('TENCENT_EMAIL_NOT_CONFIGURED')
    return { sent: false, reason: 'missing_tencent_email_config' }
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const payload = JSON.stringify({
    FromEmailAddress: `私家E院 <${config.from}>`,
    Destination: [to],
    ...content,
    Subject: subject,
    TriggerType: 1,
  })
  const authorization = buildTencentAuthorization({
    secretId: config.secretId,
    secretKey: config.secretKey,
    payload,
    timestamp,
  })
  let response: Response
  let result: {
    Response?: {
      RequestId?: string
      Error?: { Code?: string; Message?: string }
    }
  } | null
  try {
    response = await fetch(`https://${tencentEmailHost}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: tencentEmailHost,
        'X-TC-Action': 'SendEmail',
        'X-TC-Region': config.region,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Version': tencentEmailVersion,
      },
      body: payload,
      cache: 'no-store',
    })
    try {
      result = await response.json() as {
        Response?: {
          RequestId?: string
          Error?: { Code?: string; Message?: string }
        }
      } | null
    } catch {
      throw new TencentMailProviderError({
        code: 'INVALID_RESPONSE',
        message: 'Tencent SES returned a non-JSON response',
        httpStatus: response.status,
        attempt,
      })
    }
  } catch (error) {
    if (error instanceof TencentMailProviderError) throw error
    throw new TencentMailProviderError({
      code: 'TRANSPORT_ERROR',
      message: error instanceof Error ? error.message : 'fetch_failed',
      attempt,
    })
  }
  if (!result?.Response) {
    throw new TencentMailProviderError({
      code: 'INVALID_RESPONSE',
      message: 'Tencent SES response is missing Response',
      httpStatus: response.status,
      attempt,
    })
  }
  const apiError = result?.Response?.Error
  if (!response.ok || apiError) {
    throw new TencentMailProviderError({
      code: apiError?.Code || `HTTP_${response.status}`,
      message: apiError?.Message || `HTTP_${response.status}`,
      requestId: result?.Response?.RequestId,
      httpStatus: response.status,
      attempt,
    })
  }
  return { sent: true }
}

async function sendTencentTemplateMail({
  to,
  subject,
  templateId,
  templateData,
}: {
  to: string
  subject: string
  templateId: number
  templateData: Record<string, string>
}): Promise<SendMailResult> {
  return sendTencentMail({
    to,
    subject,
    templateId,
    content: {
      Template: {
        TemplateID: templateId,
        TemplateData: JSON.stringify(templateData),
      },
    },
    attempt: 'template',
  })
}

async function sendTencentSimpleMail({
  to,
  subject,
  text,
  html,
}: {
  to: string
  subject: string
  text: string
  html: string
}): Promise<SendMailResult> {
  return sendTencentMail({
    to,
    subject,
    content: {
      Simple: {
        Html: Buffer.from(html, 'utf8').toString('base64'),
        Text: Buffer.from(text, 'utf8').toString('base64'),
      },
    },
    attempt: 'simple',
  })
}

function isSimpleEmailUnsupported(error: unknown) {
  if (error instanceof TencentMailProviderError) {
    return new Set([
      'FailedOperation.WithOutPermission',
      'FailedOperation.UnsupportMailType',
      'MissingParameter.SendParamNecessary',
      'InvalidParameterValue.EmailContentIsWrong',
    ]).has(error.providerCode) || /^OperationDenied\..*Simple$/i.test(error.providerCode)
  }
  if (!(error instanceof Error)) return false
  return /TENCENT_EMAIL_SEND_FAILED:(?:FailedOperation\.WithOutPermission|FailedOperation\.UnsupportMailType|MissingParameter\.SendParamNecessary|OperationDenied\.[^:]*Simple|InvalidParameterValue\.EmailContentIsWrong)/i.test(error.message)
}

function getTemplateId(name: 'verification-link' | 'register' | 'profile' | 'reset' | 'reset-link') {
  const key = name === 'verification-link'
    ? 'TENCENT_EMAIL_VERIFICATION_LINK_TEMPLATE_ID'
    : name === 'register'
      ? 'TENCENT_EMAIL_REGISTER_TEMPLATE_ID'
      : name === 'profile'
        ? 'TENCENT_EMAIL_PROFILE_TEMPLATE_ID'
        : name === 'reset-link'
          ? 'TENCENT_EMAIL_RESET_LINK_TEMPLATE_ID'
          : 'TENCENT_EMAIL_RESET_TEMPLATE_ID'
  const fallbackKey = name === 'profile' ? 'TENCENT_EMAIL_REGISTER_TEMPLATE_ID' : undefined
  const raw = process.env[key] || (fallbackKey ? process.env[fallbackKey] : '') || ''
  return Number.parseInt(raw, 10)
}

async function sendRenderedEmail({
  to,
  subject,
  text,
  html,
  fallback,
  mailType,
}: {
  to: string
  subject: string
  text: string
  html: string
  fallback?: {
    templateId: number
    templateData: Record<string, string>
  }
  mailType: MailType
}): Promise<SendMailResult> {
  try {
    return await sendTencentSimpleMail({ to, subject, text, html })
  } catch (error) {
    console.warn('[mail.provider.failure]', {
      event: 'mail.provider.failure',
      provider: 'tencent-ses',
      mailType,
      ...providerFailureDetails(error),
    })
    if (isSimpleEmailUnsupported(error) && fallback) {
      try {
        const result = await sendTencentTemplateMail({
          to,
          subject,
          templateId: fallback.templateId,
          templateData: fallback.templateData,
        })
        console.info('[mail.provider.fallback.success]', {
          event: 'mail.provider.fallback.success',
          provider: 'tencent-ses',
          mailType,
          attempt: 'template',
        })
        return result
      } catch (fallbackError) {
        console.error('[mail.provider.fallback.failure]', {
          event: 'mail.provider.fallback.failure',
          provider: 'tencent-ses',
          mailType,
          ...providerFailureDetails(fallbackError),
        })
        throw fallbackError
      }
    }
    if (error instanceof Error && error.message === 'TENCENT_EMAIL_NOT_CONFIGURED') {
      throw new Error('EMAIL_SEND_NOT_CONFIGURED')
    }
    throw error
  }
}

/**
 * 统一验证链接邮件入口。模板在应用内完成渲染，再通过腾讯云 SES
 * Simple 发送，避免远程模板变量或图片地址漂移。
 */
export async function sendMail({
  to,
  subject,
  template,
}: {
  to: string
  subject: string
  template: MailTemplateInput
}): Promise<SendMailResult> {
  const rendered = renderEmailVerificationLink({ subject, ...template })
  return sendRenderedEmail({
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    mailType: 'verification_link',
    fallback: {
      templateId: getTemplateId('verification-link'),
      templateData: {
        title: template.title,
        intro: template.intro,
        actionText: template.actionText,
        actionUrl: template.actionUrl,
        note: template.note || '',
      },
    },
  })
}

export function verificationMailTemplate(
  verificationUrl: string,
  reason: 'register' | 'change-email' | 'resend' = 'register',
) {
  const title = reason === 'change-email' ? '验证你的新邮箱' : '验证你的私家E院邮箱'
  const intro =
    reason === 'resend'
      ? '你申请重新发送邮箱验证邮件。请点击按钮完成验证，链接 24 小时内有效。'
      : reason === 'change-email'
        ? '你正在修改私家E院账号邮箱。请点击按钮完成新邮箱验证，链接 24 小时内有效。'
        : '欢迎加入私家E院。请点击按钮完成邮箱验证，验证后即可使用邮箱登录。链接 24 小时内有效。'

  return {
    title,
    intro,
    actionText: '验证邮箱',
    actionUrl: verificationUrl,
    note: '如果不是你本人操作，请忽略这封邮件。你的密码不会因此改变。',
  }
}

/**
 * 忘记密码验证码：使用应用内完整 HTML，避免依赖云端模板中的未替换变量或相对图片地址。
 */
export async function sendPasswordResetCode(email: string, code: string): Promise<SendMailResult> {
  const rendered = renderPasswordResetEmail({
    kind: 'code',
    code,
    expiresInMinutes: PASSWORD_RESET_CODE_EXPIRY_MINUTES,
  })
  return sendRenderedEmail({
    to: email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    mailType: 'password_reset_code',
    fallback: {
      templateId: getTemplateId('reset'),
      templateData: { code },
    },
  })
}

/** 所有邮箱验证码都使用同一个应用内渲染与腾讯云 SES Simple 发送入口。 */
export async function sendEmailVerificationCode(
  email: string,
  code: string,
  reason: 'register' | 'change-email' | 'resend' = 'change-email',
): Promise<SendMailResult> {
  const rendered = renderEmailVerificationCode({
    code,
    reason,
    expiresInMinutes: EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES,
  })
  return sendRenderedEmail({
    to: email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    mailType: reason === 'register' ? 'registration_code' : 'profile_email_code',
    fallback: {
      templateId: getTemplateId(reason === 'register' ? 'register' : 'profile'),
      templateData: { code },
    },
  })
}

export async function sendRegistrationVerificationCode(
  email: string,
  code: string,
): Promise<SendMailResult> {
  return sendEmailVerificationCode(email, code, 'register')
}



/** 密码重置链接使用同一套应用内邮件视觉模板，但保留独立的链接重置流程。 */
export async function sendPasswordResetLinkEmail(
  email: string,
  resetUrl: string,
): Promise<SendMailResult> {
  const rendered = renderPasswordResetEmail({ kind: 'link', resetUrl, expiresInMinutes: 30 })
  return sendRenderedEmail({
    to: email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    mailType: 'password_reset_link',
    fallback: {
      templateId: getTemplateId('reset-link'),
      templateData: { reset_url: resetUrl },
    },
  })
}
