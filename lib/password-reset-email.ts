export const PASSWORD_RESET_EMAIL_LOGO_URL = 'https://ecfc.fans/icon.png'
export const PASSWORD_RESET_CODE_SUBJECT = '私家E院｜重置密码验证码'
export const PASSWORD_RESET_LINK_SUBJECT = '私家E院｜密码重置链接'
export const PASSWORD_RESET_CODE_EXPIRY_MINUTES = 10

type PasswordResetEmailInput =
  | { kind: 'code'; code: string; expiresInMinutes: number }
  | { kind: 'link'; resetUrl: string; expiresInMinutes: number }

export type RenderedPasswordResetEmail = {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function emailFontFamily() {
  return "Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif"
}

export function renderPasswordResetEmail(input: PasswordResetEmailInput): RenderedPasswordResetEmail {
  const expiresInMinutes = Math.max(1, Math.floor(input.expiresInMinutes))
  const fontFamily = emailFontFamily()
  const logoUrl = escapeHtml(PASSWORD_RESET_EMAIL_LOGO_URL)

  if (input.kind === 'code') {
    if (!/^\d{6}$/.test(input.code)) throw new Error('PASSWORD_RESET_EMAIL_CODE_INVALID')

    const code = escapeHtml(input.code)
    const text = [
      '私家E院 · Eason Fans Club',
      '',
      '你正在申请重置私家E院账号密码。',
      `密码重置验证码：${input.code}`,
      `验证码 ${expiresInMinutes} 分钟内有效，且只能使用一次。`,
      '',
      '如果不是你本人操作，请忽略这封邮件。',
    ].join('\n')
    const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:#eef8ff;color:#102033;font-family:${fontFamily};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background:#eef8ff;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #dbeafe;">
            <tr>
              <td align="center" style="padding:28px 28px 12px;">
                <img src="${logoUrl}" width="56" height="56" alt="私家E院" style="display:block;width:56px;height:56px;border:0;outline:none;text-decoration:none;object-fit:contain;" />
                <p style="margin:14px 0 0;font-size:12px;line-height:1.5;font-weight:700;letter-spacing:.08em;color:#0f5f8f;">私家E院 · Eason Fans Club</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 32px;">
                <h1 style="margin:0;font-size:26px;line-height:1.3;font-weight:700;color:#102033;">重置密码验证码</h1>
                <p style="margin:18px 0 0;font-size:15px;line-height:1.8;color:#475569;">你正在申请重置私家E院账号密码，请使用下面的 6 位验证码完成验证。</p>
                <p style="margin:24px 0;text-align:center;font-size:32px;line-height:1.2;font-weight:700;letter-spacing:6px;color:#0f5f8f;">${code}</p>
                <p style="margin:0;font-size:13px;line-height:1.8;color:#64748b;">验证码 ${expiresInMinutes} 分钟内有效，且只能使用一次。</p>
                <p style="margin:22px 0 0;font-size:12px;line-height:1.8;color:#94a3b8;">如果不是你本人操作，请忽略这封邮件。</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

    assertNoUnresolvedVariables(html)
    return { subject: PASSWORD_RESET_CODE_SUBJECT, text, html }
  }

  const resetUrl = escapeHtml(input.resetUrl)
  const text = [
    '私家E院 · Eason Fans Club',
    '',
    '你正在申请重置私家E院账号密码。',
    `请打开下面的重置链接（${expiresInMinutes} 分钟内有效，且只能使用一次）：`,
    input.resetUrl,
    '',
    '如果不是你本人操作，请忽略这封邮件。',
  ].join('\n')
  const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:#eef8ff;color:#102033;font-family:${fontFamily};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background:#eef8ff;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #dbeafe;">
            <tr>
              <td align="center" style="padding:28px 28px 12px;">
                <img src="${logoUrl}" width="56" height="56" alt="私家E院" style="display:block;width:56px;height:56px;border:0;outline:none;text-decoration:none;object-fit:contain;" />
                <p style="margin:14px 0 0;font-size:12px;line-height:1.5;font-weight:700;letter-spacing:.08em;color:#0f5f8f;">私家E院 · Eason Fans Club</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 32px;">
                <h1 style="margin:0;font-size:26px;line-height:1.3;font-weight:700;color:#102033;">密码重置链接</h1>
                <p style="margin:18px 0 0;font-size:15px;line-height:1.8;color:#475569;">你正在申请重置私家E院账号密码，请点击下面的按钮设置新密码。</p>
                <p style="margin:24px 0;text-align:center;"><a href="${resetUrl}" style="display:inline-block;padding:12px 22px;background:#0f5f8f;color:#ffffff;text-decoration:none;font-size:14px;line-height:1.4;font-weight:700;">打开重置密码页面</a></p>
                <p style="margin:0;font-size:13px;line-height:1.8;color:#64748b;">重置链接 ${expiresInMinutes} 分钟内有效，且只能使用一次。</p>
                <p style="margin:22px 0 0;word-break:break-all;font-size:12px;line-height:1.8;color:#0f5f8f;">${resetUrl}</p>
                <p style="margin:22px 0 0;font-size:12px;line-height:1.8;color:#94a3b8;">如果不是你本人操作，请忽略这封邮件。</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  assertNoUnresolvedVariables(html)
  return { subject: PASSWORD_RESET_LINK_SUBJECT, text, html }
}

function assertNoUnresolvedVariables(html: string) {
  if (html.includes('{{')) throw new Error('PASSWORD_RESET_EMAIL_TEMPLATE_UNRESOLVED_VARIABLE')
}
