import Link from 'next/link'
import { BadgeImage, BadgeName } from '@/components/UserDisplayName'
import { selectMiniShowcase, type BadgeMuseumItem } from '@/lib/badge-museum'
import type { BadgeCollectionView, BadgeView, EquippedBadgeView } from '@/lib/badge-types'
import { formatUid } from '@/lib/uid'

type Props = {
  uid: number
  summary: BadgeCollectionView | null
  equippedBadge?: EquippedBadgeView | null
  isSelf?: boolean
}

function isBadgeView(item: BadgeMuseumItem): item is BadgeView {
  return 'status' in item
}

export function BadgeMiniShowcase({ uid, summary, equippedBadge, isSelf = false }: Props) {
  const items = selectMiniShowcase({
    showcase: [...(summary?.showcase || [])].sort((left, right) => left.slot - right.slot).map((item) => item.badge),
    recent: summary?.recent || [],
    equipped: equippedBadge,
  })
  const href = `/user/${formatUid(uid)}/badges`

  return <section className="badge-mini-showcase" aria-labelledby={`badge-mini-showcase-${uid}`}>
    <div className="badge-mini-showcase-header"><div><p className="badge-mini-showcase-kicker">E院荣誉档案</p><h2 id={`badge-mini-showcase-${uid}`}>勋章小览</h2></div><div className="badge-mini-showcase-actions">{isSelf ? <Link href={`${href}#showcase`} className="badge-mini-showcase-edit">编辑</Link> : null}<Link href={href} className="badge-mini-showcase-all">全部 <span aria-hidden="true">→</span></Link></div></div>
    {items.length ? <div className="badge-mini-showcase-cabinet">{items.map((item: BadgeMuseumItem, index) => <Link href={`${href}?badge=${encodeURIComponent(item.id)}`} key={item.id} className="badge-mini-showcase-item" aria-label={`${item.name}勋章详情`}><span className="badge-mini-showcase-image"><BadgeImage badge={item} size="wall" /></span><BadgeName badge={item} className="badge-mini-showcase-name" />{isBadgeView(item) && item.isEquipped ? <span className="badge-mini-showcase-equipped">佩戴中</span> : index === 0 && equippedBadge?.id === item.id ? <span className="badge-mini-showcase-equipped">佩戴中</span> : null}</Link>)}</div> : <div className="badge-mini-showcase-empty"><span>还没有收藏勋章</span><Link href="/badges">去展览馆看看 →</Link></div>}
    <p className="badge-mini-showcase-count">已获得 {summary?.obtainedCount || 0} 枚</p>
  </section>
}
