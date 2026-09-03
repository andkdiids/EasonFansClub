import type { AdminNavigationGroup } from '@/components/AdminHomeSurface'

export const adminNavigationGroups: readonly AdminNavigationGroup[] = [
  {
    title: '内容安全',
    desc: '统一维护违禁词并处理历史违规内容。',
    items: [
      { href: '/admin/banned-words', title: '违禁词管理', desc: '新增、删除、启停违禁词，并重新扫描全站历史内容。' },
    ],
  },
  {
    title: '数据面板',
    desc: '查看后台运营数据与趋势。',
    items: [
      { href: '/admin/dashboard', title: '打开数据面板', desc: '查看注册、发帖、回复、挂号等核心数据。' },
    ],
  },
  {
    title: '用户管理',
    desc: '维护用户账号与默认资料资源。',
    items: [
      { href: '/admin/users', title: '用户管理', desc: '管理用户状态、权限、昵称冷却和重复账号。' },
      { href: '/admin/checkin-makeup', title: '手动补签', desc: '免费为用户补历史挂号，并记录管理员审计原因。' },
      { href: '/admin/default-avatars', title: '默认头像管理', desc: '维护系统默认头像池。' },
      { href: '/admin/user-rewards', title: '用户奖励', desc: '用户投稿、建议或内容被采纳后，记录并发放贡献奖励。' },
    ],
  },
  {
    title: '入院管理',
    desc: '统一管理体检、注册、验证与账户安全。',
    items: [
      { href: '/admin/ehospital', title: 'E院体检设置', desc: '配置听力验证的开关、题量、通过分数和每日次数。' },
      { href: '/admin/security-settings#registration-settings', title: '注册流程设置', desc: '设置注册方式与注册开关。' },
      { href: '/admin/security-settings#verification-settings', title: '验证设置', desc: '设置邮箱、手机和密保验证策略。' },
      { href: '/admin/security-settings#security-settings', title: '账户安全设置', desc: '配置密码找回和账户安全策略。' },
    ],
  },
  {
    title: '内容管理',
    desc: '集中处理首页、帖子、今日内容、留言、生日与公告。',
    items: [
      { href: '/admin/home', title: '首页内容', desc: '管理首页 Hero、文案、排序和启用状态。' },
      { href: '/admin/posts/review', title: '帖子审核', desc: '审核新帖并处理精选、置顶和拒绝。' },
      { href: '/admin/clinic', title: '阿士匹灵门诊部', desc: '处理匿名病历、会诊和举报；后台可核对真实用户身份。' },
      { href: '/admin/today', title: '今日管理', desc: '管理历史上的今天内容并审核用户提交。' },
      { href: '/admin/registration-messages', title: '挂号页留言管理', desc: '管理挂号页留言、公告和活动提醒。' },
      { href: '/admin/activities', title: '活动中心管理', desc: '创建、编辑、发布、取消和维护活动。' },
      { href: '/admin/stickers', title: '表情包审核', desc: '审核用户提交的表情包合集。' },
      { href: '/admin/birthdays', title: '生日管理', desc: '查看今日生日用户并保护隐私信息。' },
      { href: '/admin/birthday-messages', title: '生日祝福文案', desc: '维护生日纪念通知文案池。' },
      { href: '/admin/notifications', title: '公告管理', desc: '发布与管理后台系统公告。' },
      { href: '/admin/content', title: '活动内容管理', desc: '保留原内容中心入口，管理活动与其他内容入口。' },
      { href: '/admin/anywhere-door', title: '随意门管理', desc: '查看 Provider 状态、登记 Worker 同步请求并管理已同步动态。' },
      { href: '/admin/salon', title: '沙龙管理', desc: '审核演唱会记录与壁纸投稿，维护作品分类、场次和图片。' },
    ],
  },
  {
    title: '导航管理',
    desc: '统一管理 E院中心的功能入口顺序与显示状态。',
    items: [
      { href: '/admin/ecenter-features', title: 'E院中心功能排序', desc: '调整 E院中心弹窗、移动端中心菜单和侧栏快捷入口的共同顺序与启用状态。' },
    ],
  },
  {
    title: '创作平台',
    desc: '查看「贝多芬与我」工具状态、项目数量与公开审核。',
    items: [
      { href: '/admin/studio', title: '贝多芬与我管理', desc: '查看工具注册状态、项目数量和待审核公开作品。' },
    ],
  },
  {
    title: '物料兑换',
    desc: '维护限时物料、库存、兑换订单和现场核销。',
    items: [
      { href: '/admin/material-redemptions', title: '还有什么可以送给你', desc: '创建物料、设置资格条件、处理库存、订单、核销与退款。' },
    ],
  },
  {
    title: '页面视觉设置',
    desc: '统一管理网站外观与页面媒体。',
    items: [
      { href: '/admin/home', title: '首页 Hero 管理', desc: '管理首页 Hero 图片、文案和排序。' },
      { href: '/admin/appearance', title: '网站整体外观', desc: '修改前台文案、颜色、图片和导航图标。' },
      { href: '/admin/visuals', title: '页面视觉总览', desc: '进入登录、注册、欢迎页和首页视觉设置。' },
      { href: '/admin/visuals/login', title: '登录页视觉', desc: '设置登录页背景与响应式构图。' },
      { href: '/admin/visuals/register', title: '注册页视觉', desc: '设置注册页背景与响应式构图。' },
      { href: '/admin/visuals/welcome', title: '欢迎页视觉', desc: '设置欢迎页背景与响应式构图。' },
      { href: '/admin/visuals/home', title: '首页视觉', desc: '设置首页视觉媒体与构图。' },
      { href: '/admin/visuals/activities', title: '活动中心背景', desc: '设置活动中心背景媒体与响应式构图。' },
    ],
  },
  {
    title: '娱乐天空管理',
    desc: '统一进入歌词、听听题库与游戏相关配置。',
    items: [
      { href: '/admin/entertainment/lyrics', title: '歌词处方库', desc: '维护娱乐天空每日抽奖使用的歌词处方。' },
      { href: '/admin/entertainment/guess-song', title: '听听题库', desc: '维护听听题目、答案与私有音频变体。' },
      { href: '/admin/entertainment/guess-song/leaderboard', title: '听听排行榜', desc: '管理听听周榜、月榜、年榜和成绩补分。' },
      { href: '/admin/entertainment/guess-song/duel', title: '听听·对决管理', desc: '查看实时 1v1 对决、结算、断线与风控审计。' },
      { href: '/admin/entertainment/guess-song#game-config', title: '游戏相关配置', desc: '沿用听听管理页中的游戏配置入口。' },
      { href: '/admin/entertainment/want-listen', title: '想听', desc: '管理想听开关、三种模式、假歌名库与基础数据概览。' },
      { href: '/admin/entertainment/want-listen/leaderboard', title: '想听排行榜', desc: '管理想听、粤语残片、防不胜防排行榜成绩。' },
      { href: '/admin/entertainment/undercover-star', title: '卧底巨星', desc: '管理房间制多人游戏开关、词组难度、分类与使用统计。' },
      { href: '/admin/music/songs', title: '曲库管理', desc: '从 EasMusic 歌曲库维护游戏可用曲目。' },
    ],
  },
  {
    title: 'EasMusic管理',
    desc: '维护音乐专辑、歌曲、巡演和现场资料。',
    items: [
      { href: '/admin/music', title: 'EasMusic 管理', desc: '进入 EasMusic 管理总览及其子模块。' },
      { href: '/admin/ratings', title: '歌·颂管理', desc: '查看评分统计，处理违规短评；歌曲和专辑仍由曲库管理。' },
    ],
  },
  {
    title: '成就系统',
    desc: '管理成就、勋章与成长系统配置。',
    items: [
      { href: '/admin/achievements', title: '成就 / 勋章管理', desc: '管理成就、勋章、稀有度、条件和手动发放。' },
      { href: '/admin/badges', title: 'E院勋章管理', desc: '维护 PNG 勋章、图鉴可见性、昵称闪光、佩戴和发放记录。' },
      { href: '/admin/angel-gift', title: '天使的礼物', desc: '管理可配置主题、奖池、余药回收规则与执药统计。' },
      { href: '/admin/growth', title: '成长系统管理', desc: '维护等级名称、升级经验和任务奖励。' },
    ],
  },
  {
    title: 'Eason 文化馆',
    desc: '维护歌曲、专辑、电影和 Live 档案。',
    items: [
      { href: '/admin/culture', title: 'Eason 文化馆管理', desc: '管理歌曲百科、专辑馆、电影馆、Live 档案和每日一句。' },
    ],
  },
  {
    title: '管理员管理',
    desc: '维护后台管理员与权限分配。',
    items: [
      { href: '/admin/admins', title: '管理员管理', desc: '添加管理员、移除管理员并编辑后台权限。' },
      { href: '/admin/admin-actions', title: '管理员操作记录', desc: '按管理员、操作类型、对象和时间追溯内容管理操作。' },
    ],
  },
  {
    title: '更新与反馈',
    desc: '发布后台更新记录并处理用户反馈。',
    items: [
      { href: '/admin/changelog', title: '更新日志管理', desc: '发布网站更新记录与功能说明。' },
      { href: '/admin/feedback', title: '用户反馈管理', desc: '查看、回复和关闭用户反馈。' },
    ],
  },
] as const
