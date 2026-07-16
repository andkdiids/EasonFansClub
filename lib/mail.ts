type MailTemplateInput = {
  title: string
  intro: string
  actionText: string
  actionUrl: string
  note?: string
}

export type SendMailResult = { sent: true } | { sent: false; reason: 'missing_resend_api_key' }

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderTemplate(input: MailTemplateInput) {
  const title = escapeHtml(input.title)
  const intro = escapeHtml(input.intro)
  const actionText = escapeHtml(input.actionText)
  const actionUrl = escapeHtml(input.actionUrl)
  const note = escapeHtml(input.note || '如果不是你本人操作，可以忽略这封邮件。')

  const text = `${input.intro}\n\n${input.actionUrl}\n\n${input.note || '如果不是你本人操作，可以忽略这封邮件。'}`
  const html = `
    <div style="margin:0;padding:0;background:#eef8ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#102033;">
      <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
        <div style="background:#ffffff;border:1px solid #dbeafe;border-radius:24px;padding:28px;box-shadow:0 12px 32px rgba(15,95,143,0.08);">
          <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:0.18em;color:#0f5f8f;text-transform:uppercase;">EasonFansClub</p>
          <h1 style="margin:0;font-size:26px;line-height:1.25;color:#102033;">${title}</h1>
          <p style="margin:18px 0 24px;font-size:15px;line-height:1.8;color:#475569;">${intro}</p>
          <a href="${actionUrl}" style="display:inline-block;background:#0f5f8f;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 22px;font-size:14px;font-weight:800;">${actionText}</a>
          <p style="margin:24px 0 8px;font-size:13px;line-height:1.7;color:#64748b;">按钮无法打开时，请复制下面的链接到浏览器：</p>
          <p style="margin:0;word-break:break-all;font-size:12px;line-height:1.7;color:#0f5f8f;">${actionUrl}</p>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.7;color:#94a3b8;">${note}</p>
        </div>
      </div>
    </div>
  `

  return { text, html }
}

export async function sendMail({
  to,
  subject,
  template,
}: {
  to: string
  subject: string
  template: MailTemplateInput
}): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'EasonFansClub <onboarding@resend.dev>'

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('EMAIL_SEND_NOT_CONFIGURED')
    }
    return { sent: false, reason: 'missing_resend_api_key' }
  }

  const rendered = renderTemplate(template)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text: rendered.text,
      html: rendered.html,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`EMAIL_SEND_FAILED:${detail.slice(0, 120)}`)
  }

  return { sent: true }
}

export function verificationMailTemplate(verificationUrl: string, reason: 'register' | 'change-email' | 'resend' = 'register') {
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

export async function sendPasswordResetCode(email: string, code: string): Promise<SendMailResult> {
  return sendMail({
    to: email,
    subject: 'EasonFansClub 密码重置验证码',
    template: {
      title: '重置账号密码',
      intro: `你的密码重置验证码是 ${code}，10 分钟内有效。验证码只能使用一次。`,
      actionText: '返回密码重置页面',
      actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/forgot-password`,
      note: '请勿向任何人透露验证码。如果不是你本人操作，请忽略这封邮件。',
    },
  })
}
