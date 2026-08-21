import { PrismaClient } from '@prisma/client'
import { defaultBoards } from '../lib/boards'

const prisma = new PrismaClient()

async function main() {
  const existingUsers = await prisma.user.findMany({
    select: { id: true, nickname: true, avatarUrl: true, backgroundUrl: true, bio: true },
  })

  for (const user of existingUsers) {
    await prisma.profile.upsert({
      where: { userId: user.id },
      update: {
        displayName: user.nickname,
        avatarUrl: user.avatarUrl,
        backgroundUrl: user.backgroundUrl,
        bio: user.bio,
      },
      create: {
        userId: user.id,
        displayName: user.nickname,
        avatarUrl: user.avatarUrl,
        backgroundUrl: user.backgroundUrl,
        bio: user.bio,
      },
    })
  }

  const defaultCategory = await prisma.boardCategory.upsert({
    where: { slug: 'main' },
    update: {
      name: '主社区',
      description: '私家E院主要交流区域',
      sortOrder: 1,
    },
    create: {
      name: '主社区',
      slug: 'main',
      description: '私家E院主要交流区域',
      sortOrder: 1,
    },
  })

  for (const board of defaultBoards) {
    await prisma.board.upsert({
      where: { slug: board.slug },
      update: { ...board, categoryId: defaultCategory.id },
      create: { ...board, categoryId: defaultCategory.id },
    })
  }

  const badges = [
    { name: '创始会员', slug: 'founding-member', code: 'founding-member', description: '早期加入私家E院的成员' },
    { name: '连续签到', slug: 'checkin-streak', code: 'checkin-streak', description: '保持连续签到的成员' },
    { name: '发帖达人', slug: 'post-master', code: 'post-master', description: '高质量发帖成员' },
    { name: '回复达人', slug: 'reply-master', code: 'reply-master', description: '积极参与回复互动' },
    { name: '管理员', slug: 'admin', code: 'admin', description: '社区管理团队成员' },
  ]

  for (const badge of badges) {
    await prisma.badge.upsert({
      where: { slug: badge.slug },
      update: badge,
      create: badge,
    })
  }

  // 生日纪念徽章：用户生日当天由 lib/birthday.ts 自动授予，不绑定年份、永久保留。
  await prisma.badge.upsert({
    where: { slug: 'birthday-commemorative' },
    update: { name: '生日纪念', code: 'birthday-commemorative', description: '生日当天自动获得的纪念徽章', isAutoGrant: true, grantType: 'AUTO', category: 'BIRTHDAY' },
    create: { slug: 'birthday-commemorative', code: 'birthday-commemorative', name: '生日纪念', description: '生日当天自动获得的纪念徽章', isAutoGrant: true, grantType: 'AUTO', category: 'BIRTHDAY' },
  })

  const settings = [
    { key: 'site.name', value: '私家E院', label: '网站名称' },
    { key: 'site.englishName', value: 'Eason Fans Club', label: '英文名称' },
    { key: 'site.footer', value: '私家E院 · Eason Fans Club', label: '页脚' },
    { key: 'theme.mode', value: 'light', label: '默认主题' },
    { key: 'security.requireQuestionsForNewUsers', value: 'true', label: '新用户必须设置密保问题' },
    { key: 'security.notifyLegacyUsers', value: 'true', label: '通知历史用户设置密保问题' },
    { key: 'security.enableQuestionRecovery', value: 'true', label: '启用密保问题找回' },
    { key: 'security.enableEmailPasswordReset', value: 'false', label: '启用邮箱验证码重置密码' },
  ]

  for (const setting of settings) {
    await prisma.siteSetting.upsert({
      where: { key: setting.key },
      update: setting,
      create: setting,
    })
  }

  const dailyTasks = [
    { key: 'daily-checkin', title: '今日挂号', description: '选择心情，完成一次每日挂号', target: 1, points: 10, exp: 5, sortOrder: 1 },
    { key: 'listen-30m', title: '听歌30分钟', description: '给今天留半小时陈奕迅时间', target: 30, points: 5, exp: 5, sortOrder: 2 },
    { key: 'browse-10-posts', title: '浏览帖子10篇', description: '看看社区今天在聊什么', target: 10, points: 4, exp: 4, sortOrder: 3 },
    { key: 'reply-3-posts', title: '回复3条帖子', description: '认真回应也是一种陪伴', target: 3, points: 6, exp: 6, sortOrder: 4 },
    { key: 'like-5-times', title: '点赞5次', description: '把喜欢轻轻点亮', target: 5, points: 3, exp: 3, sortOrder: 5 },
  ]

  for (const task of dailyTasks) {
    await prisma.dailyTaskTemplate.upsert({
      where: { key: task.key },
      update: task,
      create: task,
    })
  }

  // 默认生日祝福文案：生日当天随机池为空时的回退内容，确保开箱即用。
  await prisma.birthdayMessage.upsert({
    where: { id: 'default-birthday-greeting' },
    update: { title: '🎂 生日纪念', content: '今天是你的生日，E院为你送上一份生日纪念。愿你继续听喜欢的歌，遇见喜欢的风景。', isActive: true },
    create: { id: 'default-birthday-greeting', title: '🎂 生日纪念', content: '今天是你的生日，E院为你送上一份生日纪念。愿你继续听喜欢的歌，遇见喜欢的风景。', isActive: true },
  })

  const tracks = [
    '富士山下',
    '十年',
    'K歌之王',
    '明年今日',
    '最佳损友',
    'Shall We Talk',
    '浮夸',
    '单车',
    '陀飞轮',
    '苦瓜',
    '葡萄成熟时',
    '沙龙',
    '任我行',
    '红玫瑰',
    '白玫瑰',
    '好久不见',
    '人来人往',
    '你的背包',
    '夕阳无限好',
    '不如这样',
  ]

  for (const [index, title] of tracks.entries()) {
    await prisma.musicTrack.upsert({
      where: { title_artist: { title, artist: '陈奕迅' } },
      update: { sortOrder: index + 1, isVisible: true },
      create: {
        title,
        artist: '陈奕迅',
        sortOrder: index + 1,
        isPlayable: false,
        source: 'official',
        sourceUrl: `https://music.163.com/#/search/m/?s=${encodeURIComponent(title + ' 陈奕迅')}`,
      },
    })
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
