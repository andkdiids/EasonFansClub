export const heroVisualKeys = ['login', 'home', 'activities', 'birthday', 'music'] as const
export type HeroVisualKey = typeof heroVisualKeys[number]
export type SiteHeroVisualConfig = {
  key: HeroVisualKey
  title: string
  imageUrl: string
  desktopPositionX: number
  desktopPositionY: number
  mobilePositionX: number
  mobilePositionY: number
  enabled: boolean
  focusPoint: { x: number; y: number } | null
  updatedAt: string
}

export const defaultHeroVisuals: Record<HeroVisualKey, SiteHeroVisualConfig> = {
  login: { key: 'login', title: '登录页 Hero', imageUrl: '', desktopPositionX: 50, desktopPositionY: 50, mobilePositionX: 50, mobilePositionY: 50, enabled: true, focusPoint: null, updatedAt: '' },
  home: { key: 'home', title: '首页 Hero', imageUrl: '', desktopPositionX: 50, desktopPositionY: 50, mobilePositionX: 50, mobilePositionY: 50, enabled: true, focusPoint: null, updatedAt: '' },
  activities: { key: 'activities', title: '活动中心 Banner', imageUrl: '', desktopPositionX: 50, desktopPositionY: 50, mobilePositionX: 50, mobilePositionY: 50, enabled: true, focusPoint: null, updatedAt: '' },
  birthday: { key: 'birthday', title: '生日应援 Banner', imageUrl: '', desktopPositionX: 50, desktopPositionY: 50, mobilePositionX: 50, mobilePositionY: 50, enabled: true, focusPoint: null, updatedAt: '' },
  music: { key: 'music', title: 'EasMusic 背景', imageUrl: '', desktopPositionX: 50, desktopPositionY: 50, mobilePositionX: 50, mobilePositionY: 50, enabled: true, focusPoint: null, updatedAt: '' },
}
