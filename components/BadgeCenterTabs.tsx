import Link from 'next/link'

export type BadgeCenterTab = 'all' | 'tasks' | 'review'

const TABS: ReadonlyArray<{ key: BadgeCenterTab; label: string; href: string }> = [
  { key: 'all', label: '全部', href: '/badges' },
  { key: 'tasks', label: '任务', href: '/badges/tasks' },
  { key: 'review', label: '回顾', href: '/badges/year-in-review' },
]

export function BadgeCenterTabs({ active }: { active: BadgeCenterTab }) {
  return (
    <nav className="badge-center-tabs" aria-label="勋章中心导航">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className="badge-center-tab"
          aria-current={active === tab.key ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
