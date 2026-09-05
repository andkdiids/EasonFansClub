import Link from 'next/link'
import Image from 'next/image'
import { PageContainer } from '@/components/PageContainer'
import { getForumBoardDisplayName } from '@/lib/boards'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { profileImageUrl } from '@/lib/images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { calculateGrowthSummary, listGrowthLevels } from '@/lib/growth'
import { AddFriendButton, FriendRequestDecision } from '@/components/FriendRequestActions'
import { publicModerationText } from '@/lib/content-moderation'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import { UserDisplayName } from '@/components/UserDisplayName'
import { findGlobalSearchUsers, getGlobalSearchPagination, parseGlobalSearchPage, searchPublicPosts } from '@/lib/global-search'

export const dynamic = 'force-dynamic'

function searchHref(query: string, page: number) {
  const params = new URLSearchParams({ q: query })
  if (page > 1) params.set('page', String(page))
  return `/search?${params.toString()}`
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams
  const q = (params.q || '').trim()
  const page = parseGlobalSearchPage(params.page)
  const [users, albums, songs] = q
    ? await Promise.all([
        findGlobalSearchUsers(q),
        prisma.musicAlbum.findMany({
          where: {
            status: 'PUBLISHED',
            OR: [{ name: { contains: q } }, { artist: { contains: q } }],
          },
          orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }],
          select: { id: true, name: true, artist: true, releaseYear: true, coverUrl: true },
          take: 10,
        }),
        prisma.musicSong.findMany({
          where: {
            MusicAlbum: { status: 'PUBLISHED' },
            OR: [
              { title: { contains: q } },
              { artist: { contains: q } },
              { lyrics: { contains: q } },
              { lyricist: { contains: q } },
              { composer: { contains: q } },
              { MusicAlbum: { name: { contains: q } } },
            ],
          },
          select: {
            id: true,
            title: true,
            artist: true,
            coverUrl: true,
            previewUrl: true,
            MusicAlbum: { select: { name: true, coverUrl: true } },
          },
          take: 16,
        }),
      ])
    : [[], [], []]

  const postSearch = q
    ? await searchPublicPosts(q, users.map((user) => user.id), page)
    : { posts: [], pagination: getGlobalSearchPagination(0, page) }
  const posts = postSearch.posts
  const postPagination = postSearch.pagination
  const hotKeywords = q
    ? []
    : await prisma.searchKeyword.findMany({ orderBy: [{ count: 'desc' }, { lastUsedAt: 'desc' }], take: 8 })

  const viewer = await getCurrentUser()
  for (const album of albums) album.coverUrl = publicImageVariantUrl(album.coverUrl, 'thumb-sm')
  for (const song of songs) {
    song.coverUrl = publicImageVariantUrl(song.coverUrl || song.MusicAlbum.coverUrl, 'thumb-sm')
    song.MusicAlbum.coverUrl = publicImageVariantUrl(song.MusicAlbum.coverUrl, 'thumb-sm')
  }
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
  const equippedBadges = await getEquippedBadgesForUsers([
    ...users.map((item) => item.id),
    ...posts.map((post) => post.User.id),
  ])

  return (
    <>
      <PageContainer className="site-page-main flat-page space-y-6 py-8">
        <section className="rounded-2xl border border-sky-100 bg-white/80 p-7 shadow-sm">
          <h1 className="text-4xl font-black text-brand-950">搜索</h1>
          <form className="mt-5 flex min-w-0 gap-3" action="/search">
            <input
              name="q"
              defaultValue={q}
              placeholder="搜索帖子、用户、板块、标签"
              className="min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-4 py-3 font-bold outline-none focus:border-brand-400"
            />
            <button className="min-h-11 shrink-0 rounded-xl bg-brand-700 px-6 py-3 font-black text-white">搜索</button>
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
          <section className="space-y-6">
            {users.length ? <h2 className="pt-3 text-lg font-black text-brand-950">用户</h2> : null}
            {users.map((item) => {
              const name = getPublicUserDisplayName(item)
              const avatar = profileImageUrl(item.Profile?.avatarUrl || item.avatarUrl)
              const growth = calculateGrowthSummary(item.experience, growthLevels)
              const status = friendIds.has(item.id) ? 'FRIEND' : sentIds.has(item.id) ? 'PENDING' : receivedIds.has(item.id) ? 'RECEIVED' : 'NONE'
              return (
                <article key={item.id} className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
                  <Link href={`/user/${formatUid(item.uid)}`} className="flex items-center gap-3 font-bold text-slate-700">
                    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden bg-brand-950 text-white">
                      {avatar ? <img src={publicImageVariantUrl(avatar, 'avatar-md') || avatar} alt={name} className="h-full w-full object-cover" loading="lazy" /> : formatUid(item.uid).slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <strong className="block break-words text-brand-950"><UserDisplayName name={name} uid={item.uid} badges={equippedBadges.get(item.id) || []} compact /></strong>
                      <small className="break-words">UID {formatUid(item.uid)} · {growth.levelName} Lv.{growth.level} · {item._count.Post} 帖</small>
                    </span>
                  </Link>
                  <p className="mt-2 break-words text-xs font-bold text-slate-500">{publicModerationText(item.Profile?.bio || `入院于 ${item.createdAt.toLocaleDateString('zh-CN')}`, item.Profile?.bioModerationStatus)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link href={`/user/${formatUid(item.uid)}`} className="border border-sky-100 px-3 py-2 text-xs font-black text-brand-700">查看主页</Link>
                    {viewer && viewer.id !== item.id && status !== 'RECEIVED' ? <AddFriendButton uid={item.uid} initialStatus={status} /> : null}
                    {status === 'RECEIVED' && receivedRequestBySender.get(item.id) ? <FriendRequestDecision requestId={receivedRequestBySender.get(item.id)!} /> : null}
                  </div>
                </article>
              )
            })}
            {posts.length ? <h2 className="pt-3 text-lg font-black text-brand-950">帖子</h2> : null}
            {posts.map((post) => (
              <Link key={post.id} href={`/posts/${post.id}`} className="block rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
                <p className="break-words font-black text-slate-950">{publicModerationText(post.title, post.moderationStatus)}</p>
                <p className="mt-2 break-words text-sm text-slate-500">
                  {getForumBoardDisplayName(post.Board)} · <UserDisplayName name={getPublicUserDisplayName(post.User)} uid={post.User.uid} badges={equippedBadges.get(post.User.id) || []} compact /> · 回复 {post.replyCount}
                </p>
              </Link>
            ))}
            {postPagination.total > 0 && (postPagination.page > 1 || postPagination.hasMore) ? (
              <nav aria-label="搜索帖子分页" className="flex flex-wrap items-center justify-between gap-3 pt-2">
                {postPagination.page > 1 ? <Link href={searchHref(q, postPagination.page - 1)} className="border border-sky-100 px-4 py-2 text-sm font-black text-brand-700">上一页</Link> : <span />}
                <span className="text-sm font-black text-slate-500">第 {postPagination.page} / {postPagination.totalPages} 页</span>
                {postPagination.hasMore ? <Link href={searchHref(q, postPagination.page + 1)} className="border border-sky-100 px-4 py-2 text-sm font-black text-brand-700">下一页</Link> : <span />}
              </nav>
            ) : null}
            {albums.length ? <h2 className="pt-3 text-lg font-black text-brand-950">专辑</h2> : null}
            {albums.map((album) => (
              <Link key={album.id} href={`/music/album/${album.id}`} className="flex items-center gap-4 rounded-2xl border border-sky-100 bg-white/80 p-4 shadow-sm">
                <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden bg-sky-50 text-brand-500">{album.coverUrl ? <Image src={album.coverUrl} alt="" fill sizes="56px" loading="lazy" className="object-cover" /> : '♪'}</span>
                <span className="min-w-0"><strong className="block break-words font-black text-slate-950">{album.name}</strong><small className="mt-1 block break-words text-sm text-slate-500">{album.artist} · {album.releaseYear}</small></span>
              </Link>
            ))}
            {songs.length ? <h2 className="pt-3 text-lg font-black text-brand-950">歌曲</h2> : null}
            {songs.map((song) => (
              <Link key={song.id} href={`/music/song/${song.id}`} className="flex items-center gap-4 rounded-2xl border border-sky-100 bg-white/80 p-4 shadow-sm">
                <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden bg-sky-50 text-brand-500">{song.coverUrl ? <Image src={song.coverUrl} alt="" fill sizes="56px" loading="lazy" className="object-cover" /> : '♪'}</span>
                <span className="min-w-0"><strong className="block break-words font-black text-slate-950">{song.title}</strong><small className="mt-1 block break-words text-sm text-slate-500">{song.artist} · {song.MusicAlbum.name} · {song.previewUrl ? '支持试听' : '暂无试听'}</small></span>
              </Link>
            ))}
            {posts.length + users.length + albums.length + songs.length === 0 ? <p className="rounded-2xl border border-sky-100 bg-white/80 p-6 text-center text-sm font-bold text-slate-500">没有找到匹配内容。</p> : null}
          </section>
        )}
      </PageContainer>
    </>
  )
}
