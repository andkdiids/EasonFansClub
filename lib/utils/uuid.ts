type UUIDCrypto = {
  randomUUID?: () => string
}

let fallbackSequence = 0

export function createUUID(cryptoApi: UUIDCrypto | undefined = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  fallbackSequence = (fallbackSequence + 1) % Number.MAX_SAFE_INTEGER
  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    fallbackSequence.toString(36),
  ].join('-')
}
