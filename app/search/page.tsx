import Link from 'next/link'
import { PageContainer } from '@/components/PageContainer'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { getCurrentUser } from '@/lib/auth'
import { publicImageUrl } from '@/lib/images'
import { calculateGrowthSummary, listGrowthLevels } from '@/lib/growth'
import { AddFriendButton, FriendRequestDecision } from '@/components/FriendRequestActions'

export const dynamic = 'force-dynamic'

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams
  const q = (params.q || '').trim()
  const numericUid = /^\d+$/.test(q) ? Number(q) : null

  const [posts, boards, users, albums, songs, hotKeywords] = q
    ? await Promise.all([
        prisma.post.findMany({
          where: {
            isDeleted: false,
            status: 'PUBLISHED',
            OR: [
              { title: { contains: q } },
              { content: { contains: q } },
            ],
          },
          include: {
            User: { select: { nickname: true, level: true } },
            Board: { select: { name: true, slug: true } },
          },
          take: 20,
        }),
        prisma.board.findMany({
          where: { isActive: true, name: { contains: q } },
          take: 10,
        }),
        prisma.user.findMany({
          where: {
            uid: { gt: 0 },
            isDeleted: false,
            status: 'ACTIVE',
            Profile: { isNot: null },
            OR: [
              ...(Number.isSafeInteger(numericUid) && Number(numericUid) > 0 ? [{ uid: Number(numericUid) }] : []),
              { nickname: { contains: q } },
              { username: { contains: q } },
              { Profile: { displayName: { contains: q } } },
            ],
          },
          select: {
            id: true, uid: true, nickname: true, username: true, avatarUrl: true, experience: true, createdAt: true, lastActiveAt: true,
            Profile: { select: { displayName: true, avatarUrl: true, bio: true } },
            _count: { select: { Post: { where: { isDeleted: false, status: 'PUBLISHED' } } } },
            Post: { where: { isDeleted: false, status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, title: true } },
          },
          take: 10,
        }),
        prisma.musicAlbum.findMany({
          where: { status: 'PUBLISHED', name: { contains: q } },
          orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }],
          select: { id: true, name: true, releaseYear: true },
          take: 10,
        }),
        prisma.musicSong.findMany({
          where: {
            MusicAlbum: { status: 'PUBLISHED' },
            OR: [
              { title: { contains: q } },
              { lyricist: { contains: q } },
              { composer: { contains: q } },
              { MusicAlbum: { name: { contains: q } } },
            ],
          },
          select: { id: true, title: true, MusicAlbum: { select: { name: true } } },
          take: 16,
        }),
        prisma.searchKeyword.findMany({ orderBy: { count: 'desc' }, take: 8 }),
      ])
    : [[], [], [], [], [], await prisma.searchKeyword.findMany({ orderBy: { count: 'desc' }, take: 8 })]

  const viewer = await getCurrentUser()
  const userIds = users.map((item) => item.id)
  const [friendships, sentRequests, receivedRequests, growthLevels] = await Promise.all([
    viewer && userIds.length ? prisma.friendship.findMany({ where: { OR: [{ userAId: viewer.id, userBId: { in: userIds } }, { userBId: viewer.id, userAId: { in: userIds } }] }, select: { userAId: true, userBId: true } }) : [],
    viewer && userIds.length ? prisma.friendRequest.findMany({ where: { senderId: viewer.id, receiverId: { in: userIds }, status: 'PENDING' }, select: { receiverId: true } }) : [],
    viewer && userIds.length ? prisma.friendRequest.findMany({ where: { receiverId: viewer.id, senderId: { in: userIds }, status: 'PENDING' }, select: { id: true, senderId: true } }) : [],
    listGrowthLevels(),
  ])
  const friendIds = new Set(friendships.flatMap((item) => [item.userAId, item.userBId]).filter((id) => id !== viewer?.id))
  const sentIds = new Set(sentRequests.map((item) => item.receiverId))
  const receivedIds = new Set(receivedRequests.map((item) => item.senderId))
  const receivedRequestBySender = new Map(receivedRequests.map((item) => [item.senderId, item.id]))

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
                    {post.Board.name} · {post.User.nickname} · 回复 {post.replyCount}
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
                  <p className="mt-2 text-sm text-slate-500">EasMusic · {song.MusicAlbum.name}</p>
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
                  {users.map((item) => {
                    const name = item.Profile?.displayName || item.nickname || item.username
                    const avatar = publicImageUrl(item.Profile?.avatarUrl || item.avatarUrl)
                    const growth = calculateGrowthSummary(item.experience, growthLevels)
                    const status = friendIds.has(item.id) ? 'FRIEND' : sentIds.has(item.id) ? 'PENDING' : receivedIds.has(item.id) ? 'RECEIVED' : 'NONE'
                    return (
                      <article key={item.id} className="border-b border-sky-100 py-3 last:border-0">
                        <Link href={`/user/${formatUid(item.uid)}`} className="flex items-center gap-3 font-bold text-slate-700">
                          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden bg-brand-950 text-white">
                            {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 1)}
                          </span>
                          <span>
                            <strong className="block text-brand-950">{name}</strong>
                            <small>UID {formatUid(item.uid)} · {growth.levelName} Lv.{growth.level} · {item._count.Post} 帖</small>
                          </span>
                        </Link>
                        <p className="mt-2 text-xs font-bold text-slate-500">{item.Profile?.bio || `入院于 ${item.createdAt.toLocaleDateString('zh-CN')}`}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link href={`/user/${formatUid(item.uid)}`} className="border border-sky-100 px-3 py-2 text-xs font-black text-brand-700">查看主页</Link>
                          {viewer && viewer.id !== item.id && status !== 'RECEIVED' ? <AddFriendButton uid={item.uid} initialStatus={status} /> : null}
                          {status === 'RECEIVED' && receivedRequestBySender.get(item.id) ? <FriendRequestDecision requestId={receivedRequestBySender.get(item.id)!} /> : null}
                        </div>
                        {item.Post.length ? <div className="mt-2 space-y-1">{item.Post.map((post) => <Link key={post.id} href={`/posts/${post.id}`} className="block truncate text-xs font-bold text-slate-600">帖子 · {post.title}</Link>)}</div> : null}
                      </article>
                    )
                  })}
                </div>
              </div>
            </aside>
          </section>
        )}
      </PageContainer>
    </>
  )
}
