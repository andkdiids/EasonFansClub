import Link from 'next/link'
import { PageContainer } from '@/components/PageContainer'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams
  const q = (params.q || '').trim()

  const [posts, boards, users, albums, songs, hotKeywords] = q
    ? await Promise.all([
        prisma.post.findMany({
          where: {
            isDeleted: false,
            status: 'PUBLISHED',
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { content: { contains: q, mode: 'insensitive' } },
            ],
          },
          include: {
            author: { select: { nickname: true, level: true } },
            board: { select: { name: true, slug: true } },
          },
          take: 20,
        }),
        prisma.board.findMany({
          where: { isActive: true, name: { contains: q, mode: 'insensitive' } },
          take: 10,
        }),
        prisma.user.findMany({
          where: {
            uid: { gt: 0 },
            isDeleted: false,
            OR: [
              { nickname: { contains: q, mode: 'insensitive' } },
              { username: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: { id: true, uid: true, nickname: true, username: true, avatarUrl: true, level: true },
          take: 10,
        }),
        prisma.musicAlbum.findMany({
          where: { status: 'PUBLISHED', name: { contains: q, mode: 'insensitive' } },
          orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }],
          select: { id: true, name: true, releaseYear: true },
          take: 10,
        }),
        prisma.musicSong.findMany({
          where: {
            album: { status: 'PUBLISHED' },
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { lyricist: { contains: q, mode: 'insensitive' } },
              { composer: { contains: q, mode: 'insensitive' } },
              { album: { name: { contains: q, mode: 'insensitive' } } },
            ],
          },
          select: { id: true, title: true, album: { select: { name: true } } },
          take: 16,
        }),
        prisma.searchKeyword.findMany({ orderBy: { count: 'desc' }, take: 8 }),
      ])
    : [[], [], [], [], [], await prisma.searchKeyword.findMany({ orderBy: { count: 'desc' }, take: 8 })]

  return (
    <>
      <PageContainer className="site-page-main flat-page space-y-6 py-8">
        <section className="rounded-2xl border border-sky-100 bg-white/80 p-7 shadow-sm">
          <p className="text-sm font-black uppercase text-brand-700">Search</p>
          <h1 className="mt-2 text-4xl font-black text-brand-950">搜索</h1>
          <form className="mt-5 flex gap-3" action="/search">
            <input
              name="q"
              defaultValue={q}
              placeholder="搜索帖子、用户、板块、标签"
              className="min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-4 py-2 font-bold outline-none focus:border-brand-400"
            />
            <button className="rounded-xl bg-brand-700 px-6 py-3 font-black text-white">搜索</button>
          </form>
        </section>

        {!q ? (
          <section className="rounded-2xl border border-sky-100 bg-white/80 p-6 shadow-sm">
            <h2 className="text-2xl font-black text-brand-950">热门搜索</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              {hotKeywords.map((item) => (
                <Link key={item.id} href={`/search?q=${encodeURIComponent(item.keyword)}`} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
                  {item.keyword}
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {posts.map((post) => (
                <Link key={post.id} href={`/posts/${post.id}`} className="block rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
                  <p className="font-black text-slate-950">{post.title}</p>
                  <p className="mt-2 text-sm text-slate-500">
                    {post.board.name} · {post.author.nickname} · 回复 {post.replyCount}
                  </p>
                </Link>
              ))}
              {albums.map((album) => (
                <Link key={album.id} href={`/music/album/${album.id}`} className="block rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
                  <p className="font-black text-slate-950">专辑 · {album.name}</p>
                  <p className="mt-2 text-sm text-slate-500">EasMusic · {album.releaseYear}</p>
                </Link>
              ))}
              {songs.map((song) => (
                <Link key={song.id} href={`/music/song/${song.id}`} className="block rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
                  <p className="font-black text-slate-950">歌曲 · {song.title}</p>
                  <p className="mt-2 text-sm text-slate-500">EasMusic · {song.album.name}</p>
                </Link>
              ))}
              {posts.length + albums.length + songs.length === 0 ? <p className="rounded-2xl border border-sky-100 bg-white/80 p-6 text-sm font-bold text-slate-500">没有找到匹配内容。</p> : null}
            </div>
            <aside className="space-y-4">
              <div className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
                <h2 className="font-black text-brand-950">相关板块</h2>
                <div className="mt-3 space-y-2">
                  {boards.map((board) => (
                    <Link key={board.id} href={`/boards/${board.slug}`} className="block font-bold text-slate-700">
                      {board.name}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
                <h2 className="font-black text-brand-950">相关用户</h2>
                <div className="mt-3 space-y-2">
                  {users.map((item) => (
                    <Link key={item.id} href={`/user/${formatUid(item.uid)}`} className="block font-bold text-slate-700">
                      {item.nickname || item.username} · 等级 {item.level}
                    </Link>
                  ))}
                </div>
              </div>
            </aside>
          </section>
        )}
      </PageContainer>
    </>
  )
}
