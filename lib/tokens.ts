import crypto from 'crypto'

export function createPlainToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}
