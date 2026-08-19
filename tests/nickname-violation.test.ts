import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  generateViolationNickname,
  generateUniqueViolationNickname,
  computeNicknameCooldownDays,
  NICKNAME_NORMAL_COOLDOWN_DAYS,
  type NicknameUniquenessClient,
} from '@/lib/nickname-violation'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicUserSelect } from '@/lib/users'

// 说明：本套测试以「纯函数 + 源码结构校验」为主（项目测试不连真实数据库），
// 覆盖需求 一~九 的关键边界：
//   - 违规展示昵称格式与唯一性（生成后回查数据库）
//   - 修正后显示正常昵称；刷新后稳定返回已生成的展示昵称
//   - 冷却规则：0~1 次违规 = 30 天；2 次及以上违规 = 60 天（动态计算，无落库字段）
//   - 再次违规生成「新的」随机昵称（不复用旧）
//   - 所有展示接口统一经 getPublicUserDisplayName 读取生效昵称

const root = process.cwd()
function source(rel: string) {
  return readFileSync(join(root, rel), 'utf8')
}
const routeSrc = source('app/api/users/me/route.ts')
const friendRemarksSrc = source('lib/friend-remarks.ts')

// 确定性 RNG（mulberry32），保证单测可复现。
function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DISPLAY_RE = /^违规昵称[A-Za-z0-9]{8}$/

test('一/唯一性：生成格式合规且不重复', () => {
  const samples = new Set<string>()
  for (let i = 0; i < 5000; i++) samples.add(generateViolationNickname(Math.random))
  assert.equal(samples.size, 5000, '5000 次随机生成应全部唯一')
  for (const s of samples) assert.match(s, DISPLAY_RE)
})

test('一/唯一性：generateUniqueViolationNickname 回查数据库，冲突时换一个', async () => {
  const rng = mulberry32(12345)
  const first = generateViolationNickname(rng)
  const client: NicknameUniquenessClient = {
    user: {
      findFirst: async ({ where }) =>
        where.nicknameViolationDisplay === first ? { id: 'existing' } : null,
    },
  }
  const result = await generateUniqueViolationNickname(client, rng)
  assert.match(result, DISPLAY_RE)
  assert.notEqual(result, first, '与已存在展示昵称冲突时应生成不同值')
})

test('七/修正后显示正常昵称', () => {
  assert.equal(
    getPublicUserDisplayName({
      nickname: '阿士匹灵',
      nicknameModerationStatus: 'NORMAL',
      nicknameViolationDisplay: null,
    }),
    '阿士匹灵',
  )
  // 修正（清除违规）后即使残留旧展示字段，也应返回真实昵称
  assert.equal(
    getPublicUserDisplayName({
      nickname: '新昵称',
      nicknameModerationStatus: 'NORMAL',
      nicknameViolationDisplay: '违规昵称OLD12345',
    }),
    '新昵称',
  )
})

test('三/刷新持久化：违规展示昵称从存储字段稳定返回', () => {
  const display = '违规昵称A82KD92L'
  const got = getPublicUserDisplayName({
    nickname: '真实昵称',
    nicknameModerationStatus: 'VIOLATION',
    nicknameViolationDisplay: display,
  })
  assert.equal(got, display)
  assert.notEqual(got, '违规用户', '昵称违规不再统一显示为「违规用户」')
})

test('五/普通修改冷却 = 30 天', () => {
  assert.equal(NICKNAME_NORMAL_COOLDOWN_DAYS, 30)
  // 0~1 次违规均返回 30 天
  assert.equal(computeNicknameCooldownDays(0), 30)
  assert.equal(computeNicknameCooldownDays(1), 30)
})

test('五/再次违规冷却 = 60 天（动态计算，2 次及以上固定 60 天）', () => {
  assert.equal(computeNicknameCooldownDays(2), 60)
  assert.equal(computeNicknameCooldownDays(3), 60)
  assert.equal(computeNicknameCooldownDays(10), 60)
  // 源码确认：冷却天数由 nicknameViolationCount 动态计算，未落库为字段
  assert.match(routeSrc, /computeNicknameCooldownDays\(current\?\.nicknameViolationCount/)
  assert.doesNotMatch(routeSrc, /nicknameChangeCooldownDays:/, '不应再写入 nicknameChangeCooldownDays 字段')
})

test('四/再次违规生成新的随机昵称（不复用旧）', async () => {
  // 模拟「旧展示昵称」仍存在于库内，再次违规时必须生成不同值
  const rng = mulberry32(999)
  const oldDisplay = '违规昵称ZZZZZZZZ'
  const client: NicknameUniquenessClient = {
    user: {
      findFirst: async ({ where }) =>
        where.nicknameViolationDisplay === oldDisplay ? { id: 'old' } : null,
    },
  }
  const result = await generateUniqueViolationNickname(client, rng)
  assert.match(result, DISPLAY_RE)
  assert.notEqual(result, oldDisplay, '再次违规不应复用旧的展示昵称')
})

test('七/所有展示接口一致：publicUserSelect 包含违规展示字段', () => {
  const sel = publicUserSelect()
  assert.equal(sel.nicknameModerationStatus, true)
  assert.equal(sel.nicknameViolationDisplay, true)
})

test('七/所有展示接口一致：昵称违规优先返回展示昵称，username 违规不遮罩昵称展示', () => {
  // 昵称违规优先返回生效展示昵称（源码确认分支存在）
  assert.match(friendRemarksSrc, /if \(user\.nicknameModerationStatus === 'VIOLATION'\)/)
  // username 是登录句柄而非展示名：其违规只遮罩 username 字段本身，不影响昵称展示
  assert.equal(
    getPublicUserDisplayName({ username: 'x', usernameModerationStatus: 'VIOLATION', nickname: '正常昵称' }),
    '正常昵称',
  )
  // 源码确认：展示函数不再因 username 残留标记返回「违规用户」
  assert.doesNotMatch(friendRemarksSrc, /user\.usernameModerationStatus === 'VIOLATION'/)
})

test('三/违规后改合法昵称，即使 username 标记残留也显示新昵称（问题根因回归）', () => {
  // 用户原 username 违规（残留），但已把昵称改为合法：
  // nicknameModerationStatus=NORMAL + nicknameViolationDisplay=null
  // → 必须显示新昵称，禁止返回「违规用户」
  assert.equal(
    getPublicUserDisplayName({
      nickname: '我的新昵称',
      nicknameModerationStatus: 'NORMAL',
      nicknameViolationDisplay: '违规昵称OLD12345',
      usernameModerationStatus: 'VIOLATION',
    }),
    '我的新昵称',
  )
})

test('二/昵称合法后即使 Profile 残留违规标记也正常显示（问题2修复）', () => {
  // 用户昵称已合法（NORMAL），但 Profile.displayNameModerationStatus 仍为 VIOLATION（历史残留）
  // → 必须显示昵称，不得再显示「违规用户」
  assert.equal(
    getPublicUserDisplayName({
      nickname: '新合法昵称',
      nicknameModerationStatus: 'NORMAL',
      Profile: { displayName: '新合法昵称', displayNameModerationStatus: 'VIOLATION' },
    }),
    '新合法昵称',
  )
  // 源码确认：展示函数不再因 Profile 残留标记返回「违规用户」
  assert.doesNotMatch(friendRemarksSrc, /profile\?\.displayNameModerationStatus === 'VIOLATION'/)
})

test('一/昵称违规但无展示昵称（历史遗留）时遮罩，不泄露真实昵称', () => {
  assert.equal(
    getPublicUserDisplayName({
      nickname: '真实违规昵称',
      nicknameModerationStatus: 'VIOLATION',
      nicknameViolationDisplay: null,
    }),
    '违规用户',
  )
})

test('二/历史违规用户修复脚本：区分仍违规与已合法两种情况', () => {
  const repairSrc = source('scripts/repair-violating-user-display-names.ts')
  // 扫描条件：用户级违规 或 Profile 残留违规标记
  assert.match(repairSrc, /nicknameModerationStatus: 'VIOLATION'/)
  assert.match(repairSrc, /displayNameModerationStatus: 'VIOLATION'/)
  // 情况A：仍违规 → 生成唯一安全展示昵称
  assert.match(repairSrc, /generateUniqueViolationNickname\(client, Math\.random\)/)
  assert.match(repairSrc, /KEEP_VIOLATION/)
  // 情况B：已合法 → 恢复正常展示，清除违规标记
  assert.match(repairSrc, /nicknameModerationStatus: 'NORMAL', nicknameViolationDisplay: null/)
  assert.match(repairSrc, /displayName: currentNickname, displayNameModerationStatus: 'NORMAL'/)
  assert.match(repairSrc, /NORMAL_RESTORE/)
  // 不删除任何数据，仅更新状态与写日志
  assert.doesNotMatch(repairSrc, /\.deleteMany|\.delete\(/)
  // 修复类型与输出字段
  assert.match(repairSrc, /KEEP_VIOLATION=|NORMAL_RESTORE=/)
})
