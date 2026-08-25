import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'eason-fans-club',
      release: process.env.DEPLOY_SHA || 'unknown',
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
