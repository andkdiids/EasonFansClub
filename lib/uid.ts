export const UID_DIGITS = 5
export const MAX_UID = 99999

export function formatUid(uid: number | string) {
  const value = Number(uid)
  if (!Number.isInteger(value) || value < 0) return String(uid)
  return String(value).padStart(UID_DIGITS, '0')
}

export function parseUidParam(uid: string) {
  if (!/^\d{1,5}$/.test(uid)) return null
  return Number(uid)
}
