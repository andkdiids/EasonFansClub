export const adminPermissionGroups = [
  { key: 'user_delete', label: '永久删除用户', description: '永久删除用户账号、私有数据，并处理公开内容归属。' },
  { key: 'user_manage', label: '用户管理', description: '查看、编辑、封禁和删除用户。' },
  { key: 'post_manage', label: '帖子管理', description: '删除、置顶、精华、推荐和锁定帖子。' },
  { key: 'reply_manage', label: '回复管理', description: '删除、恢复和屏蔽回复。' },
  { key: 'board_manage', label: '板块管理', description: '创建、编辑、隐藏和排序论坛板块。' },
  { key: 'checkin_manage', label: '每日挂号管理', description: '查看签到记录、补签和重置签到。' },
  { key: 'daily_message_manage', label: 'E友留言管理', description: '删除、精选和管理留言互动。' },
  { key: 'music_manage', label: 'EasMusic 管理', description: '维护音乐专辑、歌曲资料和播放来源预留信息。' },
  { key: 'achievement_manage', label: '成就 / 勋章管理', description: '管理成就、勋章、称号和奖励。' },
  { key: 'culture_manage', label: 'Eason 文化馆管理', description: '管理歌曲、专辑、电影、Live 档案和歌词卡片。' },
  { key: 'home_manage', label: '首页装修管理', description: '管理首页模块、轮播图和展示顺序。' },
  { key: 'nav_manage', label: '导航栏管理', description: '管理导航入口、图标、名称和排序。' },
  { key: 'site_config_manage', label: '网站外观配置', description: '管理网站文案、颜色、Logo 和图片。' },
  { key: 'account_security_manage', label: '账号安全配置', description: '管理密保与邮箱密码重置功能开关。' },
  { key: 'layout.manage', label: '页面布局草稿管理', description: '查看布局编辑器、修改模块顺序、保存布局草稿。' },
  { key: 'layout.publish', label: '页面布局发布', description: '发布线上页面布局并恢复默认布局。' },
  { key: 'feedback_manage', label: '反馈管理', description: '查看、回复和关闭用户反馈。' },
  { key: 'changelog_manage', label: '更新日志管理', description: '创建、发布和维护网站更新日志。' },
  { key: 'notification_manage', label: '全站通知管理', description: '发布、隐藏和查看全站系统通知。' },
  { key: 'stats_view', label: '数据统计查看', description: '查看后台运营数据和统计面板。' },
  { key: 'admin_manage', label: '管理员管理', description: '添加管理员、移除管理员并编辑后台权限。' },
  { key: 'growth_manage', label: '成长系统管理', description: '维护等级名称、升级经验和任务奖励基础配置。' },
] as const

export type AdminPermissionKey = (typeof adminPermissionGroups)[number]['key']

export const allAdminPermissionKeys = adminPermissionGroups.map((item) => item.key)

export const adminModulePermissions: Record<string, AdminPermissionKey> = {
  '/admin/dashboard': 'stats_view',
  '/admin/users': 'user_manage',
  '/admin/settings': 'account_security_manage',
  '/admin/security-settings': 'account_security_manage',
  '/admin/content': 'home_manage',
  '/admin/achievements': 'achievement_manage',
  '/admin/culture': 'culture_manage',
  '/admin/music': 'music_manage',
  '/admin/feedback': 'feedback_manage',
  '/admin/changelog': 'changelog_manage',
  '/admin/notifications': 'notification_manage',
  '/admin/appearance': 'site_config_manage',
  '/admin/layout-editor': 'layout.manage',
  '/admin/admins': 'admin_manage',
  '/admin/growth': 'growth_manage',
}
