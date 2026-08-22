export const loginAccountMinLength = 2
export const loginAccountMaxLength = 16
export const loginAccountCharacterError = '用户名只能包含中文、英文、数字和下划线，不能包含空格或特殊字符'
export const nicknameCharacterError = '昵称只能包含中文、英文、数字和下划线，不能包含空格或特殊字符'
export const nicknameLengthError = '昵称长度需要 2-16 个字符'

// NFKC is applied before this check so the existing full-width Latin/numeric
// input remains compatible with the normalized login-account contract.
const usernameCharacterPattern = /^[\p{Script=Han}A-Za-z0-9_]+$/u

function hasValidUsernameCharacters(value: string) {
  return Boolean(value) && usernameCharacterPattern.test(value.normalize('NFKC'))
}

export function getLoginAccountDisplay(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizeLoginAccount(value: unknown) {
  return getLoginAccountDisplay(value).normalize('NFKC').toLowerCase()
}

export function validateLoginAccountValue(value: unknown) {
  const raw = typeof value === 'string' ? value : String(value ?? '')
  const account = getLoginAccountDisplay(value)
  const usernameNormalized = normalizeLoginAccount(account)
  const displayLength = Array.from(account).length
  const normalizedLength = Array.from(usernameNormalized).length
  if (!account) return { account, usernameNormalized, error: raw ? loginAccountCharacterError : '请输入登录账号' }
  if (raw !== account || !hasValidUsernameCharacters(raw)) {
    return { account, usernameNormalized, error: loginAccountCharacterError }
  }
  if (displayLength < loginAccountMinLength || displayLength > loginAccountMaxLength || normalizedLength < loginAccountMinLength || normalizedLength > loginAccountMaxLength) {
    return { account, usernameNormalized, error: '登录账号长度需要 2-16 个字符' }
  }
  return { account, usernameNormalized, error: null }
}

/** Nickname input keeps the historical character contract without exposing
 * login-account terminology in public profile and registration feedback. */
export function validateNicknameValue(value: unknown) {
  const result = validateLoginAccountValue(value)
  if (result.error === loginAccountCharacterError) return { ...result, error: nicknameCharacterError }
  if (result.error === '登录账号长度需要 2-16 个字符') return { ...result, error: nicknameLengthError }
  if (result.error === '请输入登录账号') return { ...result, error: '请输入昵称' }
  return result
}

export function validateAdminLoginAccount(accountValue: unknown, confirmValue: unknown, currentNormalized?: string) {
  const result = validateLoginAccountValue(accountValue)
  if (result.error) return result
  if (result.usernameNormalized !== normalizeLoginAccount(confirmValue)) {
    return { ...result, error: '两次输入的登录账号不一致' }
  }
  if (currentNormalized && result.usernameNormalized === currentNormalized) {
    return { ...result, error: '新账号与原账号相同，账号不区分大小写。' }
  }
  return result
}

export function maskLoginAccount(value: string) {
  if (/^\+?\d{7,}$/.test(value)) return `${value.slice(0, 3)}****${value.slice(-4)}`
  const at = value.indexOf('@')
  if (at > 0) return `${value.slice(0, 1)}***${value.slice(at)}`
  if (Array.from(value).length <= 2) return `${Array.from(value)[0] || ''}*`
  return `${Array.from(value).slice(0, 2).join('')}***`
}

export function maskUserId(value: string) {
  return value.length <= 10 ? `${value.slice(0, 2)}***` : `${value.slice(0, 6)}...${value.slice(-4)}`
}
