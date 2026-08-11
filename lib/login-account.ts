export const loginAccountMinLength = 2
export const loginAccountMaxLength = 16
export const loginAccountCharacterError = '用户名不能包含空格或特殊符号，可使用中文、英文字母、数字和 Emoji。'

// Match one username token at a time. Letters and numbers are accepted
// directly; emoji may include variation selectors, skin-tone modifiers and
// ZWJ-linked emoji. Punctuation, separators and ordinary symbols do not
// match this expression.
const emojiBase = '(?:\\p{Extended_Pictographic}|[\\u{1F1E6}-\\u{1F1FF}])'
const emojiTail = '(?:[\\uFE0E\\uFE0F\\u{1F3FB}-\\u{1F3FF}])*'
const usernameTokenPattern = new RegExp(
  `(?:\\p{N}\\uFE0F\\u20E3|[\\p{L}\\p{N}\\p{M}]|${emojiBase}${emojiTail}(?:\\u200D${emojiBase}${emojiTail})*)`,
  'gu',
)

function hasValidUsernameCharacters(value: string) {
  if (!value) return false
  usernameTokenPattern.lastIndex = 0
  let consumed = ''
  let match: RegExpExecArray | null
  while ((match = usernameTokenPattern.exec(value))) consumed += match[0]
  return consumed === value
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
