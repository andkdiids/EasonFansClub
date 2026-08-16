import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlbumReviewActions } from '@/components/music/AlbumReviewActions'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { getCurrentUser } from '@/lib/auth'
import { readAlbumReviewImages } from '@/lib/album-reviews'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'
import { publicImageVariantUrl } from '@/lib/image-variants'

export const dynamic = 'force-dynamic'

export default async function AlbumReviewDetailPage({ params }: Readonly<{ params: Promise<{ reviewId: string }> }>) {
  const { reviewId } = await params
  const [review, user, config] = await Promise.all([
    prisma.albumReview.findFirst({
      where: { id: reviewId, status: 'PUBLISHED' },
      include: {
        MusicAlbum: { select: { id: true, name: true, releaseYear: true, language: true, coverUrl: true, _count: { select: { MusicSong: true } } } },
        User: { select: { id: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
      },
    }),
    getCurrentUser(),
    getSiteAppearance(),
  ])
  if (!review) notFound()
  const [liked, favorited] = user ? await Promise.all([
    prisma.albumReviewLike.findUnique({ where: { reviewId_userId: { reviewId, userId: user.id } } }),
    prisma.albumReviewFavorite.findUnique({ where: { reviewId_userId: { reviewId, userId: user.id } } }),
  ]) : [null, null]
  const remarkMap = await loadFriendRemarkMap(user?.id, [review.User.id])
  const reviewAuthorName = resolveFriendDisplayName({
    viewerId: user?.id,
    targetUserId: review.User.id,
    fallbackName: getPublicUserDisplayName(review.User),
    remarkMap,
  })
  const images = readAlbumReviewImages(review.images).map((url) => publicImageVariantUrl(url, 'large') || url)
  const albumCoverForHero = publicImageVariantUrl(review.MusicAlbum.coverUrl, 'large')
  review.coverUrl = publicImageVariantUrl(review.coverUrl, 'large')
  review.MusicAlbum.coverUrl = publicImageVariantUrl(review.MusicAlbum.coverUrl, 'thumb-sm')
  return <MusicArchiveShell maxWidth="max-w-5xl" backgroundVisual={config.heroVisuals.music}>
    <Link href="/music/reviews" className="text-sm font-black text-sky-300/80">← 返回专辑鉴赏</Link>
    <article className="mt-10 overflow-hidden rounded-[32px] border border-white/10 bg-[#08192b]/80 shadow-[0_30px_90px_rgba(0,0,0,.28)] backdrop-blur-xl">
      {(review.coverUrl || albumCoverForHero) ? <div className="relative aspect-[16/8]"><Image src={(review.coverUrl || albumCoverForHero)!} alt={review.title} fill priority sizes="(max-width: 767px) 100vw, 960px" className="object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#08192b] via-transparent to-transparent" /></div> : null}
      <div className="p-6 sm:p-10">
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">ALBUM REVIEW · {review.MusicAlbum.releaseYear}</p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-white sm:text-6xl">{review.title}</h1>
        <p className="mt-5 text-sm font-bold text-slate-300/60">所属专辑：<Link href={`/music/album/${review.MusicAlbum.id}`} className="text-sky-200 hover:text-white">《{review.MusicAlbum.name}》</Link> · {reviewAuthorName} · {new Intl.DateTimeFormat('zh-CN').format(review.publishedAt || review.createdAt)}</p>
        <div className="mt-8"><AlbumReviewActions reviewId={review.id} initialLiked={Boolean(liked)} initialFavorited={Boolean(favorited)} initialLikeCount={review.likeCount} initialFavoriteCount={review.favoriteCount} /></div>
        <div className="mt-10 whitespace-pre-wrap text-[15px] font-medium leading-8 text-slate-200/85 sm:text-base">{review.content}</div>
        {images.length ? <div className="mt-10 grid gap-5">{images.map((url, index) => <figure key={url} className="relative aspect-[16/10] overflow-hidden rounded-[24px] border border-white/10 bg-[#0b2038]"><Image src={url} alt={`${review.title} 资料图片 ${index + 1}`} fill sizes="(max-width: 767px) 100vw, 900px" loading="lazy" className="object-contain" /></figure>)}</div> : null}
        <aside className="mt-12 grid gap-5 rounded-[24px] border border-sky-300/15 bg-sky-300/[0.06] p-5 sm:grid-cols-[112px_1fr] sm:items-center">
          <div className="relative aspect-square overflow-hidden rounded-[18px] bg-[#0b2038]">{review.MusicAlbum.coverUrl ? <Image src={review.MusicAlbum.coverUrl} alt={`${review.MusicAlbum.name}专辑封面`} fill sizes="112px" className="object-cover" /> : null}</div>
          <div><h2 className="text-2xl font-black text-white">相关专辑：《{review.MusicAlbum.name}》</h2><p className="mt-2 text-sm font-bold text-slate-300/60">{review.MusicAlbum.releaseYear} · {review.MusicAlbum.language} · {review.MusicAlbum._count.MusicSong} 首歌曲</p><Link href={`/music/album/${review.MusicAlbum.id}`} className="mt-4 inline-flex text-sm font-black text-sky-200">查看专辑档案 →</Link></div>
        </aside>
      </div>
    </article>
  </MusicArchiveShell>
}
