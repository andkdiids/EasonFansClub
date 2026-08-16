const punctuationPattern = /[\s\p{P}\p{S}]+/gu

export function normalizeUndercoverWord(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(punctuationPattern, '')
}

export function normalizeUndercoverDescription(value: unknown) {
  return normalizeUndercoverWord(value)
}

export function isDirectUndercoverWordMention(description: string, word: string) {
  const normalizedDescription = normalizeUndercoverDescription(description)
  const normalizedWord = normalizeUndercoverWord(word)
  return Boolean(normalizedWord && normalizedDescription.includes(normalizedWord))
}

export function normalizedUndercoverPairKey(civilianWord: string, undercoverWord: string) {
  return `${normalizeUndercoverWord(civilianWord)}\u0000${normalizeUndercoverWord(undercoverWord)}`
}
