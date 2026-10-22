import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({ code: 'EMAIL_PASSWORD_RECOVERY_DISABLED', message: '邮箱密码找回暂未开放，请使用密保方式或联系管理员。' }, {
    status: 410,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
