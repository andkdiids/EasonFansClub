/**
 * CheckIn.type 的统一展示语义（纯前端元数据，无任何服务端依赖）。
 *
 * 事实源约定：
 * - 业务计算（累计/连续/勋章）：NORMAL 与 MAKEUP_* 都视为「已完成挂号」，本模块不参与。
 * - 展示语义：NORMAL → 「已挂号」；MAKEUP_FREE_QUIZ / MAKEUP_PAID / MAKEUP_ADMIN → 「补签」。
 * - 后台可细分来源：正常挂号 / 免费答题补签 / 付费补签 / 管理员补签。
 * - 历史兼容：type 为 NULL/空/未知（旧版正常挂号数据）一律归一为 NORMAL，绝不显示为补签/未知。
 */

export type CheckInTypeValue = 'NORMAL' | 'MAKEUP_FREE_QUIZ' | 'MAKEUP_PAID' | 'MAKEUP_ADMIN'

export type CheckInCategory = 'NORMAL' | 'MAKEUP'

export type CheckInTypeMeta = {
  type: CheckInTypeValue
  category: CheckInCategory
  isMakeup: boolean
  /** 前台统一主标签：已挂号 / 补签 */
  frontLabel: string
  /** 后台细分标签：正常挂号 / 免费答题补签 / 付费补签 / 管理员补签 */
  adminLabel: string
}

export const MAKEUP_CHECK_IN_TYPES: readonly CheckInTypeValue[] = ['MAKEUP_FREE_QUIZ', 'MAKEUP_PAID', 'MAKEUP_ADMIN']

const CHECK_IN_TYPE_META: Record<CheckInTypeValue, CheckInTypeMeta> = {
  NORMAL: {
    type: 'NORMAL',
    category: 'NORMAL',
    isMakeup: false,
    frontLabel: '已挂号',
    adminLabel: '正常挂号',
  },
  MAKEUP_FREE_QUIZ: {
    type: 'MAKEUP_FREE_QUIZ',
    category: 'MAKEUP',
    isMakeup: true,
    frontLabel: '补签',
    adminLabel: '免费答题补签',
  },
  MAKEUP_PAID: {
    type: 'MAKEUP_PAID',
    category: 'MAKEUP',
    isMakeup: true,
    frontLabel: '补签',
    adminLabel: '付费补签',
  },
  MAKEUP_ADMIN: {
    type: 'MAKEUP_ADMIN',
    category: 'MAKEUP',
    isMakeup: true,
    frontLabel: '补签',
    adminLabel: '管理员补签',
  },
}

export function isCheckInTypeValue(value: unknown): value is CheckInTypeValue {
  return value === 'NORMAL' || value === 'MAKEUP_FREE_QUIZ' || value === 'MAKEUP_PAID' || value === 'MAKEUP_ADMIN'
}

export function isMakeupCheckInType(value: unknown): boolean {
  return value === 'MAKEUP_FREE_QUIZ' || value === 'MAKEUP_PAID' || value === 'MAKEUP_ADMIN'
}

/** NULL / 空 / 未知值（旧版无 type 的正常挂号数据）归一为 NORMAL。 */
export function normalizeCheckInType(value: unknown): CheckInTypeValue {
  return isCheckInTypeValue(value) ? value : 'NORMAL'
}

export function getCheckInTypeMeta(value: unknown): CheckInTypeMeta {
  return CHECK_IN_TYPE_META[normalizeCheckInType(value)]
}
