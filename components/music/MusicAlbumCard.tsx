import Link from 'next/link'
import { MusicCover } from '@/components/music/MusicCover'

type MusicAlbumCardProps = {
  album: {
    id: string
    name: string
    artist: string
    releaseYear: number
    coverUrl?: string | null
    language?: string | null
    songCount?: number
  }
  theme?: 'light' | 'dark'
}

export function MusicAlbumCard({ album, theme = 'light' }: Readonly<MusicAlbumCardProps>) {
  return (
    <Link href={`/music/album/${album.id}`} className="group block min-w-0">
      <MusicCover src={album.coverUrl} alt={`${album.name}专辑封面`} className="aspect-square rounded-[24px] shadow-lg shadow-sky-950/10 transition duration-300 group-hover:-translate-y-2 group-hover:scale-[1.03] group-hover:shadow-[0_22px_55px_rgba(39,154,241,.22)]" />
      <h3 className={`mt-3 truncate text-lg font-black ${theme === 'dark' ? 'text-white' : 'text-brand-950'}`}>{album.name}</h3>
      <p className={`mt-1 text-sm font-bold ${theme === 'dark' ? 'text-slate-300/70' : 'text-slate-500'}`}>{album.releaseYear}{album.language ? ` · ${album.language}` : ''}</p>
      {typeof album.songCount === 'number' ? <p className={`mt-1 text-xs font-bold ${theme === 'dark' ? 'text-sky-200/55' : 'text-slate-400'}`}>{album.songCount} Tracks</p> : null}
    </Link>
  )
}
