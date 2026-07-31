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
}: {
  items: SetlistItemForBlock[]
  title: string
  eyebrow?: string
  idPrefix?: string
}) {
  const grouped = Object.entries(MUSIC_SETLIST_SECTION_LABELS)
    .map(([section, label]) => ({ section, label, items: items.filter((item) => item.section === section) }))
    .filter((group) => group.items.length)
  if (!grouped.length) return null
  const headingId = `${idPrefix}-title`
  return (
    <section className="mt-14" aria-labelledby={headingId}>
      <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">{eyebrow}</p>
      <h2 id={headingId} className="mt-2 text-3xl font-black text-white sm:text-4xl">{title}</h2>
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
