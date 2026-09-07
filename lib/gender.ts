export const GENDER_VALUES = ['MALE', 'FEMALE', 'CUSTOM'] as const
export type GenderValue = typeof GENDER_VALUES[number]

export const CUSTOM_GENDER_MAX_LENGTH = 20

export const GENDER_INVALID_MESSAGE = '请选择有效的性别选项'
export const CUSTOM_GENDER_INVALID_MESSAGE = '自定义性别需填写 1-20 个普通文本字符，且不能包含换行或 HTML 标记'

function isGenderValue(value: unknown): value is GenderValue {
  return typeof value === 'string' && (GENDER_VALUES as readonly string[]).includes(value)
}

export function normalizeCustomGenderValue(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

export type GenderInputValidation = {
  gender: GenderValue | null
  customGender: string | null
  error: string | null
}

/**
 * Browser-safe validation shared by the profile editors and the server APIs.
 * The API additionally applies the server-side banned-word check before it
 * persists the returned custom value.
 */
export function validateGenderInput(genderInput: unknown, customGenderInput: unknown): GenderInputValidation {
  const gender = genderInput == null || genderInput === '' ? null : genderInput
  if (gender !== null && !isGenderValue(gender)) {
    return { gender: null, customGender: null, error: GENDER_INVALID_MESSAGE }
  }

  if (gender !== 'CUSTOM') {
    return { gender, customGender: null, error: null }
  }

  const customGender = normalizeCustomGenderValue(customGenderInput)
  if (!customGender || /[\r\n]/u.test(customGender) || /[<>]/u.test(customGender) || /javascript\s*:/iu.test(customGender)) {
    return { gender: 'CUSTOM', customGender: null, error: CUSTOM_GENDER_INVALID_MESSAGE }
  }
  if ([...customGender].length > CUSTOM_GENDER_MAX_LENGTH) {
    return { gender: 'CUSTOM', customGender: null, error: CUSTOM_GENDER_INVALID_MESSAGE }
  }

  return { gender: 'CUSTOM', customGender, error: null }
}

export function getGenderDisplay(user: { gender?: string | null; customGender?: string | null } | null | undefined) {
  if (!user) return null
  if (user.gender === 'MALE') return '男'
  if (user.gender === 'FEMALE') return '女'
  if (user.gender === 'CUSTOM') {
    const customGender = normalizeCustomGenderValue(user.customGender)
    return customGender || null
  }
  return null
}
