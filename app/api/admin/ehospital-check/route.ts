import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/security'
import { EHospitalCheckError, getEHospitalCheckConfig, updateEHospitalCheckConfig } from '@/lib/ehospital-check'
import { rejectInvalidRequestOrigin } from '@/lib/security'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  const guard = await requireAdmin('account_security_manage')
  if (!guard.user) return guard.response
  try {
    const config = await getEHospitalCheckConfig()
    return NextResponse.json({ config }, { headers: noStoreHeaders })
  } catch (error) {
    console.error('[admin.ehospital-check.get]', error)
    return NextResponse.json({ message: '读取配置失败' }, { status: 500, headers: noStoreHeaders })
  }
}

export async function PUT(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('account_security_manage')
  if (!guard.user) return guard.response
  try {
    const body = await request.json().catch(() => null)
    const config = await updateEHospitalCheckConfig({
      enabled: body?.enabled === true,
      questionCount: Number(body?.questionCount),
      audioSeconds: Number(body?.audioSeconds),
      passScore: Number(body?.passScore),
      dailyLimit: Number(body?.dailyLimit),
    })
    return NextResponse.json({ config, message: 'E院体检配置已保存' }, { headers: noStoreHeaders })
  } catch (error) {
    if (error instanceof EHospitalCheckError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status, headers: noStoreHeaders })
    console.error('[admin.ehospital-check.put]', error)
    return NextResponse.json({ message: '保存配置失败' }, { status: 500, headers: noStoreHeaders })
  }
}
