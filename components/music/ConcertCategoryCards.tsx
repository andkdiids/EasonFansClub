import Link from 'next/link'
import type { ConcertCategoryConfig } from '@/lib/music-concert-category'

// 演唱会分类卡片导航：渲染所有已启用分类为可点击卡片，链接到对应分类详情页 /music/live/[slug]。
// 不隐藏任何分类、也不全部跳转到大型演唱会；activeSlug 用于在当前分类详情页高亮对应卡片。
export function ConcertCategoryCards({
  categories,
  activeSlug,
  className,
}: Readonly<{
  categories: ConcertCategoryConfig[]
  activeSlug?: string
  className?: string
}>) {
  if (!categories.length) return null
  return (
    <nav
      aria-label="演唱会分类"
      className={`grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4${className ? ` ${className}` : ''}`}
    >
      {categories.map((category) => {
        const active = activeSlug === category.slug
        return (
          <Link
            key={category.id}
            href={`/music/live/${category.slug}`}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex min-w-0 flex-col items-start overflow-hidden rounded-2xl border px-5 py-4 transition${
              active
                ? ' border-sky-300/60 bg-sky-300/[0.12]'
                : ' border-white/10 bg-white/[0.05] hover:border-sky-300/30 hover:bg-white/[0.09]'
            }`}
          >
            <span className="truncate text-base font-black text-white">{category.name}</span>
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-black text-sky-200/75">
              进入分类
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
