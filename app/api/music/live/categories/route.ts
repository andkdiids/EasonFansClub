import { NextResponse } from 'next/server'
import { getEnabledConcertCategories } from '@/lib/music-concert-category'

export const dynamic = 'force-dynamic'

// 公开接口：返回已启用的演唱会分类（按 sortOrder 排序），供前台「分类导航」使用。
export async function GET() {
  const categories = await getEnabledConcertCategories().catch(() => [])
  return NextResponse.json(
    { categories: categories.map((category) => ({ slug: category.slug, name: category.name, sortOrder: category.sortOrder })) },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } },
  )
}
