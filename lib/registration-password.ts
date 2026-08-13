export const REGISTRATION_PASSWORD_MIN_LENGTH = 8
export const REGISTRATION_PASSWORD_REQUIRED_ERROR = '请输入密码'
export const REGISTRATION_PASSWORD_LENGTH_ERROR = '密码至少需要 8 位'
export const REGISTRATION_CONFIRM_PASSWORD_REQUIRED_ERROR = '请输入确认密码'
export const REGISTRATION_PASSWORD_MISMATCH_ERROR = '两次输入的密码不一致'

export function validateRegistrationPasswordFields(password: string, confirmPassword: string) {
  const errors: Partial<{ password: string; confirmPassword: string }> = {}

  if (!password) errors.password = REGISTRATION_PASSWORD_REQUIRED_ERROR
  else if (password.length < REGISTRATION_PASSWORD_MIN_LENGTH) errors.password = REGISTRATION_PASSWORD_LENGTH_ERROR

  if (!confirmPassword) errors.confirmPassword = REGISTRATION_CONFIRM_PASSWORD_REQUIRED_ERROR
  else if (password && confirmPassword !== password) errors.confirmPassword = REGISTRATION_PASSWORD_MISMATCH_ERROR

  return errors
}
