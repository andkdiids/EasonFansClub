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
}

export function MusicAlbumCard({ album }: Readonly<MusicAlbumCardProps>) {
  return (
    <Link href={`/music/album/${album.id}`} className="group block min-w-0">
      <MusicCover src={album.coverUrl} alt={`${album.name}专辑封面`} className="aspect-square rounded-[26px] shadow-lg shadow-sky-950/10 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-xl" />
      <h3 className="mt-3 truncate text-lg font-black text-brand-950">{album.name}</h3>
      <p className="mt-1 text-sm font-bold text-slate-500">{album.releaseYear}{album.language ? ` · ${album.language}` : ''}</p>
      {typeof album.songCount === 'number' ? <p className="mt-1 text-xs font-bold text-slate-400">{album.songCount} 首歌曲</p> : null}
    </Link>
  )
}
