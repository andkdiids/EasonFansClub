/**
 * 昵称违规处理核心模块。
 *
 * 设计要点（对应需求 一 / 四 / 五）：
 *  - 真实昵称（nickname）与展示昵称（nicknameViolationDisplay）分离，违规时保留真实昵称供后台审查。
 *  - 违规展示昵称格式：固定前缀「违规昵称」+ 8 位 [A-Za-z0-9] 随机串，例如「违规昵称A82KD92L」。
 *  - 生成后必须回查数据库，确保 nicknameViolationDisplay 全局唯一（不出现两个用户显示同一串）。
 *  - 再次违规时生成「全新」随机串，不复用旧的展示昵称（需求 四）。
 *  - 冷却天数：普通修改 / 修正违规 = 30 天；违规升级按 violationCount 递增 30 / 60 / 90…（需求 五）。
 *
 * 该模块不依赖真实数据库客户端：唯一性回查通过结构化入参 client 注入，
 * 既能接 Prisma Client / 事务 client，也便于在单测中传入 mock。
 */

export const VIOLATION_NICKNAME_PREFIX = '违规昵称'
export const VIOLATION_NICKNAME_SUFFIX_LENGTH = 8
export const VIOLATION_NICKNAME_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 普通昵称修改冷却天数（需求 五 Case 1 / Case 2）。 */
export const NICKNAME_NORMAL_COOLDOWN_DAYS = 30

/** 结构化查询客户端：只要具备 user.findFirst 即可（Prisma Client / 事务 client / mock 均满足）。 */
export interface NicknameUniquenessClient {
  user: {
    findFirst(args: { where: { nicknameViolationDisplay: string } }): Promise<{ id: string } | null>
  }
}

/**
 * 纯函数：生成一条违规展示昵称。rng 可注入，便于单测确定性断言。
 * 默认使用 Math.random。
 */
export function generateViolationNickname(rng: () => number = Math.random): string {
  let suffix = ''
  for (let i = 0; i < VIOLATION_NICKNAME_SUFFIX_LENGTH; i++) {
    const index = Math.floor(rng() * VIOLATION_NICKNAME_CHARSET.length)
    suffix += VIOLATION_NICKNAME_CHARSET[index]
  }
  return `${VIOLATION_NICKNAME_PREFIX}${suffix}`
}

/**
 * 生成「唯一」的违规展示昵称：循环生成并回查数据库，直到不冲突为止。
 * 8 位 [A-Za-z0-9] 的排列空间约 2.8e12，碰撞概率极低；maxAttempts 仅作防御性兜底。
 */
export async function generateUniqueViolationNickname(
  client: NicknameUniquenessClient,
  rng: () => number = Math.random,
  maxAttempts = 20,
): Promise<string> {
  let lastCandidate = generateViolationNickname(rng)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = attempt === 0 ? lastCandidate : generateViolationNickname(rng)
    lastCandidate = candidate
    const existing = await client.user.findFirst({ where: { nicknameViolationDisplay: candidate } })
    if (!existing) return candidate
  }
  // 极端兜底：追加一位随机字符后再尝试一次，仍冲突则直接返回（唯一索引会在写入时兜底）。
  const fallback = `${lastCandidate}${VIOLATION_NICKNAME_CHARSET[Math.floor(rng() * VIOLATION_NICKNAME_CHARSET.length)]}`
  const existing = await client.user.findFirst({ where: { nicknameViolationDisplay: fallback } })
  return existing ? lastCandidate : fallback
}

/**
 * 违规冷却天数计算规则（按需求 五 调整为分档）：
 *  - 0~1 次违规：30 天（普通修改 / 首次违规整改）
 *  - 2 次及以上违规：60 天（整改后再次违规）
 * 传入的 violationCount 为「当前累计」违规次数。
 */
export function computeNicknameCooldownDays(violationCount: number): number {
  return violationCount >= 2 ? 60 : NICKNAME_NORMAL_COOLDOWN_DAYS
}
