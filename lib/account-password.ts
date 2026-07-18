export function validateNewPassword(password: unknown, confirmPassword: unknown) {
  if (typeof password !== 'string' || typeof confirmPassword !== 'string') return '请输入新密码和确认密码'
  if (password.length < 8) return '新密码至少需要 8 位'
  if (password.length > 128) return '新密码不能超过 128 位'
  if (password !== confirmPassword) return '两次输入的新密码不一致'
  return null
}
