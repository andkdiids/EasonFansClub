import { NextResponse } from 'next/server'
import { searchPublicMaterialReferences } from '@/lib/rich-text-references'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/material-redemptions/reference-search',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  const query = sanitizeText(new URL(request.url).searchParams.get('q'), 100).trim()
  if (!query) return NextResponse.json({ materials: [] }, { headers: privateHeaders })

  try {
    const materials = await searchPublicMaterialReferences(query)
    return NextResponse.json({ materials }, { headers: privateHeaders })
  } catch (error) {
    console.error('[material-redemptions.reference-search]', error)
    return NextResponse.json({ message: '物料搜索暂时不可用' }, { status: 503, headers: privateHeaders })
  }
}
