import bcrypt from 'bcryptjs'

const pbkdf2Prefix = 'pbkdf2'
const pbkdf2Algorithm = 'SHA-256'
const pbkdf2HashBytes = 32
const pbkdf2SaltBytes = 16
const defaultPbkdf2Iterations = 50000

export type PasswordVerifyResult = {
  valid: boolean
  needsRehash: boolean
}

export class LegacyPasswordVerificationUnavailableError extends Error {
  constructor() {
    super('Legacy bcrypt verification is disabled in this runtime')
    this.name = 'LegacyPasswordVerificationUnavailableError'
  }
}

export function isPbkdf2PasswordHash(hash: string) {
  return hash.startsWith(`${pbkdf2Prefix}$`)
}

export function isLegacyBcryptHash(hash: string) {
  return /^\$2[aby]\$/.test(hash)
}

function pbkdf2Iterations() {
  const value = Number(process.env.PBKDF2_ITERATIONS)
  return Number.isFinite(value) && value >= 10000 ? Math.floor(value) : defaultPbkdf2Iterations
}

function canVerifyLegacyBcrypt() {
  if (process.env.ALLOW_LEGACY_BCRYPT_VERIFY === 'true') return true
  if (process.env.PRISMA_USE_DRIVER_ADAPTER === 'true') return false
  return true
}

function toBase64(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false

  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index]
  }
  return diff === 0
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const passwordBytes = new TextEncoder().encode(password)
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(passwordBytes),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: pbkdf2Algorithm,
      salt: toArrayBuffer(salt),
      iterations,
    },
    key,
    pbkdf2HashBytes * 8,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(pbkdf2SaltBytes))
  const iterations = pbkdf2Iterations()
  const hash = await derivePbkdf2(password, salt, iterations)

  return [
    pbkdf2Prefix,
    pbkdf2Algorithm.toLowerCase().replace('-', ''),
    iterations,
    toBase64(salt),
    toBase64(hash),
  ].join('$')
}

async function verifyPbkdf2Password(password: string, storedHash: string): Promise<PasswordVerifyResult> {
  const [, algorithm, iterationsValue, saltValue, hashValue] = storedHash.split('$')
  const iterations = Number(iterationsValue)
  if (algorithm !== 'sha256' || !Number.isFinite(iterations) || !saltValue || !hashValue) {
    return { valid: false, needsRehash: false }
  }

  const salt = fromBase64(saltValue)
  const expected = fromBase64(hashValue)
  const actual = await derivePbkdf2(password, salt, iterations)

  return {
    valid: timingSafeEqual(actual, expected),
    needsRehash: iterations < pbkdf2Iterations(),
  }
}

export async function verifyPassword(password: string, storedHash: string): Promise<PasswordVerifyResult> {
  if (isPbkdf2PasswordHash(storedHash)) {
    return verifyPbkdf2Password(password, storedHash)
  }

  if (isLegacyBcryptHash(storedHash)) {
    if (!canVerifyLegacyBcrypt()) {
      throw new LegacyPasswordVerificationUnavailableError()
    }

    return {
      valid: await bcrypt.compare(password, storedHash),
      needsRehash: true,
    }
  }

  return { valid: false, needsRehash: false }
}
