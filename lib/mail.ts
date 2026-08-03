import { createHash, createHmac } from 'node:crypto'

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

  const config = getTencentEmailConfig()


  if (
    !config.secretId ||
    !config.secretKey ||
    !Number.isInteger(templateId) ||
    templateId <= 0
  ) {

    if (process.env.NODE_ENV === 'production') {
      throw new Error('TENCENT_EMAIL_NOT_CONFIGURED')
    }

    return {
      sent: false,
      reason: 'missing_tencent_email_config',
    }
  }


  const action = 'SendEmail'

  const timestamp =
    Math.floor(Date.now() / 1000)


  const payload = JSON.stringify({
    FromEmailAddress: `私家E院 <${config.from}>`,
    Destination: [to],

    Template: {

      TemplateID:
        templateId,

      TemplateData:
        JSON.stringify(templateData),
    },

    Subject:
      subject,

    TriggerType:
      1,
  })


  const authorization =
    buildTencentAuthorization({

      secretId:
        config.secretId,

      secretKey:
        config.secretKey,

      payload,

      timestamp,
    })


  const response = await fetch(
    `https://${tencentEmailHost}`,
    {
      method: 'POST',

      headers: {

        Authorization:
          authorization,

        'Content-Type':
          'application/json; charset=utf-8',

        Host:
          tencentEmailHost,

        'X-TC-Action':
          action,

        'X-TC-Region':
          config.region,

        'X-TC-Timestamp':
          String(timestamp),

        'X-TC-Version':
          tencentEmailVersion,
      },

      body:
        payload,

      cache:
        'no-store',
    },
  )


  const result =
    await response
      .json()
      .catch(() => null) as {
        Response?: {
          Error?: {
            Code?: string
            Message?: string
          }
        }
      } | null


  const apiError =
    result?.Response?.Error


  if (!response.ok || apiError) {

    const detail =
      apiError
        ? `${apiError.Code || 'UNKNOWN'}:${apiError.Message || ''}`
        : `HTTP_${response.status}`


    throw new Error(
      `TENCENT_EMAIL_SEND_FAILED:${detail.slice(0, 180)}`
    )
  }


  return {
    sent: true,
  }
}

function getCompatibilityTemplateId() {
  return Number.parseInt(
    process.env.TENCENT_EMAIL_VERIFICATION_TEMPLATE_ID ||
    process.env.TENCENT_EMAIL_RESET_TEMPLATE_ID ||
    '',
    10,
  )
}

/**
 * 兼容旧的通用邮件调用方，实际仍通过腾讯云 SES 模板发送。
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
  try {
    return await sendTencentTemplateMail({
      to,
      subject,
      templateId: getCompatibilityTemplateId(),
      templateData: {
        title: template.title,
        intro: template.intro,
        actionText: template.actionText,
        actionUrl: template.actionUrl,
        note: template.note || '',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'TENCENT_EMAIL_NOT_CONFIGURED') {
      throw new Error('EMAIL_SEND_NOT_CONFIGURED')
    }
    throw error
  }
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
 * 忘记密码验证码兼容入口，继续使用现有腾讯云 SES 重置模板。
 */
export async function sendPasswordResetCode(email: string, code: string): Promise<SendMailResult> {
  try {
    return await sendTencentTemplateMail({
      to: email,
      subject: 'EasonFansClub 密码重置验证码',
      templateId: Number.parseInt(process.env.TENCENT_EMAIL_RESET_TEMPLATE_ID || '', 10),
      templateData: { code },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'TENCENT_EMAIL_NOT_CONFIGURED') {
      throw new Error('EMAIL_SEND_NOT_CONFIGURED')
    }
    throw error
  }
}


/**
 * 注册邮箱验证码
 * 腾讯云模板变量：
 * {{code}}
 */
export async function sendRegistrationVerificationCode(
  email: string,
  code: string,
): Promise<SendMailResult> {


  const templateId =
    Number.parseInt(
      process.env.TENCENT_EMAIL_REGISTER_TEMPLATE_ID || '',
      10,
    )


  return sendTencentTemplateMail({

    to:
      email,

    subject:
      'EasonFansClub 注册验证码',

    templateId,

    templateData: {
      code,
    },
  })
}



/**
 * 密码重置链接
 * 腾讯云模板变量：
 * {{reset_url}}
 */
export async function sendPasswordResetLinkEmail(
  email: string,
  resetUrl: string,
): Promise<SendMailResult> {


  const templateId =
    Number.parseInt(
      process.env.TENCENT_EMAIL_RESET_TEMPLATE_ID || '',
      10,
    )


  return sendTencentTemplateMail({

    to:
      email,

    subject:
      'EasonFansClub 密码重置链接',

    templateId,

    templateData: {
      reset_url: resetUrl,
    },
  })
}
