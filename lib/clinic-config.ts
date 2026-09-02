import type { ClinicCategory, ClinicIdentityMode, ClinicNeedType } from '@prisma/client'
import { REPLY_MAX_LENGTH } from '@/lib/reply-length'

export const CLINIC_PAGE_SIZE = 20
export const CLINIC_RECORD_MAX_LENGTH = 2000
export const CLINIC_CONSULTATION_MAX_LENGTH = REPLY_MAX_LENGTH
export const CLINIC_RECORD_DAILY_LIMIT = 20
export const CLINIC_RECORD_RATE_LIMIT_SECONDS = 60
export const CLINIC_CONSULTATION_RATE_LIMIT_SECONDS = 10

export const clinicCategoryOptions: ReadonlyArray<{
  value: ClinicCategory
  label: string
  description: string
}> = [
  { value: 'WORK_INJURY', label: '工伤门诊', description: '工作、上班、老板、同事、加班。' },
  { value: 'HEARTBREAK', label: '心碎门诊', description: '感情、友情、人际关系。' },
  { value: 'LIFE_IS_NOT_WORTH_IT', label: '人间不值得', description: '生活破事、倒霉事、日常吐槽。' },
  { value: 'EASON_AFTEREFFECT', label: 'Eason 后遗症', description: '陈奕迅、歌曲、演唱会、追星情绪。' },
  { value: 'JUSTICE', label: '天公地道', description: '纯吐槽、发疯、想找人一起骂。' },
  { value: 'LOW_PRESSURE', label: '今日低气压', description: '心情不好、疲惫、emo。' },
  { value: 'GOOD_TODAY', label: '今日好返啲', description: '分享开心、治愈、值得记录的小事。' },
  { value: 'ASK_DOCTORS', label: '各位医师点睇', description: '希望大家提供建议。' },
  { value: 'TREE_HOLE', label: '树洞', description: '不想分类，只想说点什么。' },
]

export const clinicNeedOptions: ReadonlyArray<{ value: ClinicNeedType; label: string }> = [
  { value: 'JUST_LISTEN', label: '听我讲就好' },
  { value: 'WAKE_ME_UP', label: '请各位医师骂醒我' },
  { value: 'GIVE_ADVICE', label: '帮我出出主意' },
  { value: 'FIND_SOMEONE_SAME', label: '有没有人跟我一样' },
  { value: 'ROAST_WITH_ME', label: '帮我一起吐槽' },
  { value: 'CASUAL_CHAT', label: '随便聊聊' },
]

export const clinicIdentityOptions: ReadonlyArray<{ value: ClinicIdentityMode; label: string }> = [
  { value: 'PUBLIC', label: '公开挂号' },
  { value: 'ANONYMOUS', label: '匿名挂号' },
]

export const clinicReportReasons = [
  '人身攻击',
  '泄露隐私',
  '广告 / 引流',
  '色情低俗',
  '违法违规',
  '恶意刷屏',
  '其他',
] as const

export type ClinicSort = 'latest' | 'consultations' | 'aspirin'

export function getClinicCategoryOption(value: ClinicCategory) {
  return clinicCategoryOptions.find((item) => item.value === value) || clinicCategoryOptions[clinicCategoryOptions.length - 1]
}

export function getClinicNeedLabel(value: ClinicNeedType) {
  return clinicNeedOptions.find((item) => item.value === value)?.label || value
}

export function parseClinicCategory(value: unknown): ClinicCategory | undefined {
  return clinicCategoryOptions.some((item) => item.value === value) ? value as ClinicCategory : undefined
}

export function parseClinicNeedType(value: unknown): ClinicNeedType | undefined {
  return clinicNeedOptions.some((item) => item.value === value) ? value as ClinicNeedType : undefined
}

export function parseClinicIdentityMode(value: unknown): ClinicIdentityMode {
  return value === 'ANONYMOUS' ? 'ANONYMOUS' : 'PUBLIC'
}

export function parseClinicSort(value: unknown): ClinicSort {
  return value === 'consultations' || value === 'aspirin' ? value : 'latest'
}

export function clinicAnonymousName(number: number, role: 'patient' | 'doctor' = 'patient') {
  return `${role === 'doctor' ? '匿名医师' : '匿名患者'} #${number}`
}
