import Link from 'next/link'
import { MUSIC_SETLIST_SECTION_LABELS } from '@/lib/music-live'

export type SetlistItemForBlock = {
  id: string
  displayName?: string | null
  section: string
  position: number
  versionName?: string | null
  note?: string | null
  isEncore: boolean
  isRequest: boolean
  isDebut: boolean
  isGuest: boolean
  isMedley: boolean
  isSpecial: boolean
  MusicSong?: { id?: string | null; title?: string | null } | null
}

export function SetlistBlock({
  items,
  title,
  eyebrow = 'LIVE SETLIST',
  idPrefix = 'setlist',
  excludeEncore = false,
  layout = 'sections',
  showHeading = true,
}: {
  items: SetlistItemForBlock[]
  title: string
  eyebrow?: string
  idPrefix?: string
  excludeEncore?: boolean
  layout?: 'sections' | 'columns'
  showHeading?: boolean
}) {
  const source = excludeEncore ? items.filter((item) => !item.isEncore) : items
  // 主歌单与 Encore 拆分：Encore 不混入主歌单
  const normalItems = items.filter((item) => !item.isEncore)
  const encoreItems = items.filter((item) => item.isEncore)
  const showEncore = !excludeEncore
  if (!source.length) return null
  const headingId = `${idPrefix}-title`
  const encoreHeadingId = `${idPrefix}-encore-title`

  // 三列（桌面）/ 两列（平板）/ 单列（手机）扁平展示：主歌单与 Encore 分离
  if (layout === 'columns') {
    const sorted = [...normalItems].sort((left, right) => left.position - right.position)
    const hasNormal = sorted.length > 0
    return (
      <section className="concert-setlist-block mt-14" aria-labelledby={showHeading ? headingId : undefined} aria-label={showHeading ? undefined : '完整歌单'}>
        {showHeading ? <>
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">{eyebrow}</p>
        <h2 id={headingId} className="mt-2 text-3xl font-black text-white sm:text-4xl">{title}</h2>
        </> : null}
        {hasNormal ? (
          <ol className="concert-setlist-items mt-7 gap-x-10 [column-fill:_balance] columns-1 md:columns-2 lg:columns-3">
            {sorted.map((item) => {
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
                    <span className="shrink-0 text-sm font-black text-sky-300/55">{String(item.position).padStart(2, '0')}</span>
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
        {showEncore ? (
          <div className="mt-10 border-t border-white/10 pt-8">
            <h3 id={encoreHeadingId} className="text-xl font-black text-sky-100">Encore</h3>
            {encoreItems.length ? (
              <ol className="mt-4 space-y-2">
                {[...encoreItems]
                  .sort((left, right) => left.position - right.position)
                  .map((item, idx) => {
                    const name = item.MusicSong?.title || item.displayName || '未命名曲目'
                    return (
                      <li key={item.id} className="flex items-baseline gap-3">
                        <span className="shrink-0 text-sm font-black text-sky-300/55">{String(idx + 1).padStart(2, '0')}</span>
                        <span className="min-w-0 break-words font-bold text-white/90">《{name}》</span>
                      </li>
                    )
                  })}
              </ol>
            ) : (
              <p className="mt-3 text-sm font-medium text-slate-400">暂无 Encore</p>
            )}
          </div>
        ) : null}
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
    </section>
  )
}
