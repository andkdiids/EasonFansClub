import Link from 'next/link'
import { MusicCover } from '@/components/music/MusicCover'
import { formatTrackCount } from '@/lib/music-display'

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
    <Link href={`/music/album/${album.id}`} className={`group mx-auto block w-full max-w-[175px] min-w-0 rounded-[20px] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07182d] sm:max-w-none ${theme === 'dark' ? 'text-white' : 'text-brand-950'}`}>
<MusicCover 
  src={album.coverUrl} 
  alt={`${album.name}专辑封面`} 
  className="aspect-square rounded-[18px] shadow-lg shadow-sky-950/10 transition duration-300 group-hover:-translate-y-0.5 group-hover:scale-[1.025] group-hover:shadow-[0_18px_45px_rgba(39,154,241,.18)] sm:rounded-[24px]"
/>      <h3 className="mt-2.5 line-clamp-2 text-sm font-black leading-5 sm:mt-3 xl:min-h-10 xl:text-[15px] xl:leading-5">{album.name}</h3>
      <p className={`mt-1 truncate text-xs font-bold ${theme === 'dark' ? 'text-slate-300/70' : 'text-slate-500'}`}>{album.releaseYear}{album.language ? ` · ${album.language}` : ''}</p>
      {album.songCount !== undefined ? <p className={`mt-1 text-[11px] font-bold sm:text-xs ${theme === 'dark' ? 'text-sky-200/55' : 'text-slate-400'}`}>{formatTrackCount(album.songCount)}</p> : null}
    </Link>
  )
}
