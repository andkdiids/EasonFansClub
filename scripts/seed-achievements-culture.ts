import { AchievementCategory, AchievementRarity, CultureContentType, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const achievements = [
  ['REGISTER', '初入E院', 'first-admission', '🩺', '完成注册，成为私家E院成员。', 'registered', 1, 'NORMAL', 1],
  ['REGISTER', '正式入院', 'profile-completed', '🏥', '完善个人资料。', 'profileCompleted', 1, 'RARE', 2],
  ['REGISTER', '获得UID', 'uid-assigned', '🪪', '成功分配唯一 UID。', 'uidAssigned', 1, 'NORMAL', 3],
  ['CHECKIN_STREAK', '连续3天挂号', 'checkin-streak-3', '💊', '连续挂号 3 天。', 'checkinStreak', 3, 'NORMAL', 10],
  ['CHECKIN_STREAK', '连续7天挂号', 'checkin-streak-7', '💉', '连续挂号 7 天。', 'checkinStreak', 7, 'RARE', 11],
  ['CHECKIN_STREAK', '连续30天挂号', 'checkin-streak-30', '🩹', '连续挂号 30 天。', 'checkinStreak', 30, 'EPIC', 12],
  ['CHECKIN_STREAK', '百日病历', 'checkin-streak-100', '📋', '连续挂号 100 天，解锁百日病历徽章、专属称号及一次性挂号费奖励。', 'checkinStreak', 100, 'LEGENDARY', 13],
  ['CHECKIN_STREAK', '连续365天挂号', 'checkin-streak-365', '👨‍⚕️', '连续挂号 365 天。', 'checkinStreak', 365, 'LIMITED', 14],
  ...[7, 27, 74, 270, 727, 1874].map((days, index) => [
    'CHECKIN_TOTAL',
    `累计${days}天挂号`,
    `checkin-total-${days}`,
    '📅',
    `累计完成 ${days} 天挂号。`,
    'checkinTotal',
    days,
    index >= 4 ? 'LEGENDARY' : index >= 2 ? 'EPIC' : 'RARE',
    30 + index,
  ]),
  ['POST', '第一篇病历', 'first-post', '📝', '发布第一篇帖子。', 'postTotal', 1, 'NORMAL', 50],
  ...[10, 50, 100, 500].map((count, index) => [
    'POST',
    `累计${count}篇病历`,
    `post-total-${count}`,
    '📚',
    `累计发布 ${count} 篇帖子。`,
    'postTotal',
    count,
    index >= 2 ? 'EPIC' : 'RARE',
    51 + index,
  ]),
  ...[1, 10, 50, 100, 500].map((hours, index) => [
    'MUSIC',
    `累计听歌${hours}小时`,
    `music-hours-${hours}`,
    '🎧',
    `EasMusic 累计听歌 ${hours} 小时。`,
    'listenHours',
    hours,
    index >= 3 ? 'LEGENDARY' : index >= 2 ? 'EPIC' : 'RARE',
    70 + index,
  ]),
  ...[100, 500, 1000].map((count, index) => [
    'MUSIC',
    `累计播放${count}首`,
    `music-plays-${count}`,
    '🎵',
    `累计播放 ${count} 首歌曲。`,
    'playTotal',
    count,
    index >= 2 ? 'LEGENDARY' : 'EPIC',
    80 + index,
  ]),
  ['FRIEND', '第一个E友', 'first-friend', '🤝', '添加第一位好友。', 'friendTotal', 1, 'NORMAL', 90],
  ...[10, 50, 100].map((count, index) => [
    'FRIEND',
    `${count}位好友`,
    `friends-${count}`,
    '💙',
    `拥有 ${count} 位 E友。`,
    'friendTotal',
    count,
    index >= 2 ? 'LEGENDARY' : index >= 1 ? 'EPIC' : 'RARE',
    91 + index,
  ]),
  ['ACTIVE', '入院一周', 'active-week', '🌤️', '注册满一周。', 'activeDays', 7, 'NORMAL', 100],
  ['ACTIVE', '入院一个月', 'active-month', '🌙', '注册满一个月。', 'activeDays', 30, 'RARE', 101],
  ['ACTIVE', '入院一年', 'active-year', '☀️', '注册满一年。', 'activeDays', 365, 'EPIC', 102],
  ['ACTIVE', '十年同行', 'active-ten-years', '💎', '注册满十年。', 'activeDays', 3650, 'LEGENDARY', 103],
  ['SPECIAL', 'Fear and Dreams', 'special-fear-and-dreams', '🎫', '特殊活动成就，由管理员手动发放。', null, null, 'LIMITED', 120],
  ['SPECIAL', '演唱会达人', 'special-live-fan', '🎤', '特殊活动成就，由管理员手动发放。', null, null, 'EPIC', 121],
  ['SPECIAL', '私家E院元老', 'special-founder', '🏛️', '特殊纪念成就，由管理员手动发放。', null, null, 'LEGENDARY', 122],
]

const cultureItems = [
  ['SONG', '富士山下', 'song-fuji-mountain', 'Love is a mountain.', '《富士山下》相关歌曲百科，可在后台继续维护创作背景与版本资料。', '富士山下'],
  ['SONG', '十年', 'song-ten-years', '时间留下回声。', '《十年》相关歌曲百科，可在后台继续维护创作背景与版本资料。', '十年'],
  ['SONG', 'K歌之王', 'song-king-of-karaoke', '唱给每一个听见的人。', '《K歌之王》相关歌曲百科，可在后台继续维护创作背景与版本资料。', 'K歌之王'],
  ['SONG', '明年今日', 'song-next-year-today', '把今日留给明年。', '《明年今日》相关歌曲百科，可在后台继续维护创作背景与版本资料。', '明年今日'],
  ['SONG', 'Shall We Talk', 'song-shall-we-talk', '开口，也是一种靠近。', '《Shall We Talk》相关歌曲百科，可在后台继续维护创作背景与版本资料。', 'Shall We Talk'],
  ['SONG', '浮夸', 'song-exaggerated', '声音里的戏剧性。', '《浮夸》相关歌曲百科，可在后台继续维护创作背景与版本资料。', '浮夸'],
  ['ALBUM', 'U87', 'album-u87', '一张被反复提起的专辑。', '专辑介绍、曲目与收藏进度可在后台继续维护。', null],
  ['ALBUM', 'The Line-Up', 'album-the-line-up', '一段香港流行音乐的现场感。', '专辑介绍、曲目与收藏进度可在后台继续维护。', null],
  ['ALBUM', "What's Going On...?", 'album-whats-going-on', '问题，也是一种叙事。', '专辑介绍、曲目与收藏进度可在后台继续维护。', null],
  ['ALBUM', "C'mon In~", 'album-cmon-in', '请进，听一会儿。', '专辑介绍、曲目与收藏进度可在后台继续维护。', null],
  ['ALBUM', 'The Key', 'album-the-key', '打开一些隐秘的情绪。', '专辑介绍、曲目与收藏进度可在后台继续维护。', null],
  ['FILM', '金鸡', 'film-golden-chicken', '电影档案。', '电影角色、海报、剧照和评论可在后台继续维护。', null],
  ['FILM', '十二夜', 'film-twelve-nights', '电影档案。', '电影角色、海报、剧照和评论可在后台继续维护。', null],
  ['LIVE', 'Fear and Dreams', 'live-fear-and-dreams', '一场梦，也是一段病历。', '演唱会时间、城市、曲目、照片和视频可在后台继续维护。', null],
  ['LIVE', "Another Eason's LIFE", 'live-another-easons-life', '关于现场的另一种生命力。', '演唱会时间、城市、曲目、照片和视频可在后台继续维护。', null],
]

const dailyQuotes = [
  ['好久不见', '好久不见'],
  ['shall we talk', 'Shall We Talk'],
  ['陪你度过漫长岁月', '陪你度过漫长岁月'],
]

async function main() {
  for (const item of achievements) {
    const [category, title, slug, icon, description, conditionKey, conditionValue, rarity, sortOrder] = item
    await prisma.achievement.upsert({
      where: { slug: String(slug) },
      update: {
        title: String(title),
        icon: String(icon),
        description: String(description),
        category: category as AchievementCategory,
        conditionKey: conditionKey ? String(conditionKey) : null,
        conditionValue: conditionValue ? Number(conditionValue) : null,
        rarity: rarity as AchievementRarity,
        sortOrder: Number(sortOrder),
        isAutoGrant: Boolean(conditionKey),
        isVisible: true,
      },
      create: {
        title: String(title),
        slug: String(slug),
        icon: String(icon),
        description: String(description),
        category: category as AchievementCategory,
        conditionKey: conditionKey ? String(conditionKey) : null,
        conditionValue: conditionValue ? Number(conditionValue) : null,
        rarity: rarity as AchievementRarity,
        sortOrder: Number(sortOrder),
        isAutoGrant: Boolean(conditionKey),
      },
    })
  }

  for (const [type, title, slug, subtitle, summary, songTitle] of cultureItems) {
    const itemSlug = String(slug)
    const itemTitle = String(title)
    const itemSubtitle = String(subtitle)
    const itemSummary = String(summary)
    const excerpt = songTitle ? String(songTitle).slice(0, 10) : null
    await prisma.cultureItem.upsert({
      where: { slug: itemSlug },
      update: { type: type as CultureContentType, title: itemTitle, subtitle: itemSubtitle, summary: itemSummary, legalExcerpt: excerpt, isVisible: true },
      create: { type: type as CultureContentType, title: itemTitle, slug: itemSlug, subtitle: itemSubtitle, summary: itemSummary, legalExcerpt: excerpt },
    })
  }

  for (const [content, songTitle] of dailyQuotes) {
    const quoteContent = String(content)
    const quoteSongTitle = String(songTitle)
    await prisma.dailyQuote.upsert({
      where: { id: `seed-${quoteContent}` },
      update: { content: quoteContent, songTitle: quoteSongTitle, isVisible: true },
      create: { id: `seed-${quoteContent}`, content: quoteContent, songTitle: quoteSongTitle, isVisible: true },
    })
  }

  await prisma.lyricCardTemplate.upsert({
    where: { id: 'seed-template-apple-blue' },
    update: { name: 'Apple 蓝白渐变', textColor: '#071722', accentColor: '#1985c2', isVisible: true },
    create: { id: 'seed-template-apple-blue', name: 'Apple 蓝白渐变', textColor: '#071722', accentColor: '#1985c2' },
  })
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
