import Link from 'next/link'
import { isExplicitEncoreSetlistItem, MUSIC_SETLIST_SECTION_LABELS, sortSetlistItems } from '@/lib/music-live'
import { ConcertContributorAttribution, type ConcertContributor } from '@/components/music/ConcertContributorAttribution'

export type SetlistItemForBlock = {
  id: string
  displayName?: string | null
  section: string
  position: number
  createdAt?: Date | string | null
  versionName?: string | null
  note?: string | null
  isEncore?: boolean | null
  isRequest: boolean
  isDebut: boolean
  isGuest: boolean
  isMedley: boolean
  isSpecial: boolean
  MusicSong?: { id?: string | null; title?: string | null } | null
}

function EncoreSection({ items, headingId, contributor }: { items: SetlistItemForBlock[]; headingId: string; contributor?: ConcertContributor | null }) {
  return (
    <div className="mt-10 border-t border-white/10 pt-8">
      <h3 id={headingId} className="text-xl font-black text-sky-100">Encore</h3>
      {items.length ? (
        <ol className="mt-4 space-y-2">
          {items.map((item, index) => {
            const name = item.MusicSong?.title || item.displayName || '未命名曲目'
            return (
              <li key={item.id} className="flex items-baseline gap-3">
                <span className="shrink-0 text-sm font-black text-sky-300/55">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0 break-words font-bold text-white/90">《{name}》</span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm font-medium text-slate-400">暂无 Encore</p>
      )}
      <ConcertContributorAttribution type="ENCORE" contributor={contributor} />
    </div>
  )
}

export function SetlistBlock({
  items,
  title,
  eyebrow = 'LIVE SETLIST',
  idPrefix = 'setlist',
  excludeEncore = false,
  showEncore = true,
  layout = 'sections',
  showHeading = true,
  setlistContributor,
  encoreContributor,
}: {
  items: SetlistItemForBlock[]
  title: string
  eyebrow?: string
  idPrefix?: string
  excludeEncore?: boolean
  showEncore?: boolean
  layout?: 'sections' | 'columns'
  showHeading?: boolean
  setlistContributor?: ConcertContributor | null
  encoreContributor?: ConcertContributor | null
}) {
  const orderedItems = sortSetlistItems(items)
  // 主歌单与 Encore 拆分：Encore 不混入主歌单
  const normalItems = orderedItems.filter((item) => !isExplicitEncoreSetlistItem(item))
  const encoreItems = orderedItems.filter((item) => isExplicitEncoreSetlistItem(item))
  const source = normalItems
  const showEncoreSection = showEncore && !excludeEncore
  if (!normalItems.length && (!showEncoreSection || !encoreItems.length)) return null
  const headingId = `${idPrefix}-title`
  const encoreHeadingId = `${idPrefix}-encore-title`

  // 三列（桌面）/ 单列（手机）扁平展示：主歌单与 Encore 分离
  if (layout === 'columns') {
    const sorted = sortSetlistItems(normalItems)
    const hasNormal = sorted.length > 0
    return (
      <section className="concert-setlist-block mt-14" aria-labelledby={showHeading ? headingId : undefined} aria-label={showHeading ? undefined : '完整歌单'}>
        {showHeading ? <>
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">{eyebrow}</p>
        <h2 id={headingId} className="mt-2 text-3xl font-black text-white sm:text-4xl">{title}</h2>
        </> : null}
        {hasNormal ? (
          <ol className="concert-setlist-items mt-7 gap-x-10 [column-fill:_balance] columns-1 md:columns-3">
            {sorted.map((item, index) => {
              const name = item.MusicSong?.title || item.displayName || '未命名曲目'
              const tags = [
                item.isRequest && '点歌',
                item.isDebut && '首唱',
                item.isGuest && '嘉宾',
                item.isMedley && '串烧',
                item.isSpecial && '特别演唱',
              ].filter(Boolean) as string[]
              return (
                <li key={item.id} className="break-inside-avoid py-2">
                  <div className="flex items-baseline gap-3">
                    <span className="shrink-0 text-sm font-black text-sky-300/55">{String(index + 1).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      {item.MusicSong?.id ? (
                        <Link href={`/music/song/${item.MusicSong.id}`} className="break-words font-black text-white hover:text-sky-200">{name}</Link>
                      ) : (
                        <span className="break-words font-black text-white">{name}</span>
                      )}
                      {tags.length ? (
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {tags.map((tag) => (
                            <span key={tag} className="border border-sky-300/20 px-1.5 py-0.5 text-[10px] font-black text-sky-100/75">{tag}</span>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        ) : null}
        <ConcertContributorAttribution type="SETLIST" contributor={setlistContributor} />
        {showEncoreSection ? <EncoreSection items={encoreItems} headingId={encoreHeadingId} contributor={encoreContributor} /> : null}
      </section>
    )
  }

  const grouped = Object.entries(MUSIC_SETLIST_SECTION_LABELS)
    .map(([section, label]) => ({ section, label, items: source.filter((item) => item.section === section) }))
    .filter((group) => group.items.length)
  return (
    <section className="concert-setlist-block mt-14" aria-labelledby={showHeading ? headingId : undefined} aria-label={showHeading ? undefined : '完整歌单'}>
      {showHeading ? <>
      <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">{eyebrow}</p>
      <h2 id={headingId} className="mt-2 text-3xl font-black text-white sm:text-4xl">{title}</h2>
      </> : null}
      <div className="mt-7 space-y-8">
        {grouped.map((group) => (
          <section key={group.section}>
            <h3 className="border-b border-white/10 pb-3 text-lg font-black text-sky-100">{group.label}</h3>
            <ol className="mt-2 divide-y divide-white/10 border-y border-white/10">
              {group.items.map((item) => {
                const tags = [
                  item.isEncore && 'Encore',
                  item.isRequest && '点歌',
                  item.isDebut && '首唱',
                  item.isGuest && '嘉宾',
                  item.isMedley && '串烧',
                  item.isSpecial && '特别演唱',
                ].filter(Boolean)
                const name = item.MusicSong?.title || item.displayName || '未命名曲目'
                return (
                  <li key={item.id} className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[48px_minmax(0,1fr)_minmax(160px,auto)] sm:items-center">
                    <span className="text-sm font-black text-sky-300/55">{String(item.position).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      {item.MusicSong?.id ? (
                        <Link href={`/music/song/${item.MusicSong.id}`} className="break-words font-black text-white hover:text-sky-200">{name}</Link>
                      ) : (
                        <span className="break-words font-black text-white">{name}</span>
                      )}
                      {tags.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">
                          {tags.map((tag) => <span key={String(tag)} className="border border-sky-300/20 px-2 py-1 text-[10px] font-black text-sky-100/75">{tag}</span>)}
                        </div>
                      ) : null}
                      {item.versionName || item.note ? (
                        <p className="mt-2 break-words text-xs font-medium text-slate-300/60 sm:hidden">{[item.versionName, item.note].filter(Boolean).join(' · ')}</p>
                      ) : null}
                    </div>
                    <div className="col-start-2 hidden min-w-0 sm:block">
                      {tags.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {tags.map((tag) => <span key={String(tag)} className="border border-sky-300/20 px-2 py-1 text-[10px] font-black text-sky-100/75">{tag}</span>)}
                        </div>
                      ) : null}
                      {item.versionName || item.note ? (
                        <p className="mt-2 break-words text-xs font-medium text-slate-300/60">{[item.versionName, item.note].filter(Boolean).join(' · ')}</p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
      <ConcertContributorAttribution type="SETLIST" contributor={setlistContributor} />
      {showEncoreSection ? <EncoreSection items={encoreItems} headingId={encoreHeadingId} contributor={encoreContributor} /> : null}
    </section>
  )
}
