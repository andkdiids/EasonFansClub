import { pinyin } from 'pinyin-pro'

export const FRIEND_DIRECTORY_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#',
] as const

export type FriendDirectoryLetter = typeof FRIEND_DIRECTORY_LETTERS[number]

export type FriendSortInfo = {
  sortName: string
  normalizedName: string
  indexLetter: FriendDirectoryLetter
  sortKey: string
}

export type IndexedFriend<T> = T & FriendSortInfo

export type FriendDirectorySection<T> = {
  letter: FriendDirectoryLetter
  friends: IndexedFriend<T>[]
}

const directoryLetterOrder = new Map<FriendDirectoryLetter, number>(
  FRIEND_DIRECTORY_LETTERS.map((letter, index) => [letter, index]),
)
const friendDirectoryCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const hanPinyinCache = new Map<string, string>()
const hanCharacterPattern = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u
const numberPattern = /^\p{N}$/u

function normalizeLatin(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFC')
}

function getLatinLetter(value: string) {
  const normalized = normalizeLatin(value)
  return /^[A-Za-z]$/.test(normalized) ? normalized.toUpperCase() : null
}

function isHanCharacter(value: string) {
  return hanCharacterPattern.test(value)
}

function getHanPinyin(value: string) {
  const cached = hanPinyinCache.get(value)
  if (cached !== undefined) return cached

  let result = ''
  try {
    const converted = pinyin(value, { toneType: 'none', type: 'array' })[0]
    result = normalizeLatin(converted || '').toLowerCase()
  } catch {
    // A malformed historical nickname must not make the whole directory fail.
  }
  hanPinyinCache.set(value, result)
  return result
}

function getNormalizedPinyin(value: string) {
  const parts: string[] = []
  let latinRun = ''

  const flushLatinRun = () => {
    if (!latinRun) return
    parts.push(latinRun)
    latinRun = ''
  }

  for (const character of Array.from(value)) {
    if (isHanCharacter(character)) {
      flushLatinRun()
      parts.push(getHanPinyin(character) || normalizeLatin(character).toLowerCase())
      continue
    }

    const normalized = normalizeLatin(character)
    if (/^[A-Za-z0-9]$/.test(normalized)) {
      latinRun += normalized.toLowerCase()
      continue
    }

    flushLatinRun()
    if (/^\s$/u.test(character)) continue
    if (/^\p{M}$/u.test(character)) continue
    parts.push(normalized.toLowerCase())
  }

  flushLatinRun()
  return parts.join(' ').trim()
}

export function getFriendDisplaySortName(displayName: string | null | undefined) {
  return typeof displayName === 'string' ? displayName.trim() : ''
}

export function getInitialLetter(displayName: string | null | undefined): FriendDirectoryLetter {
  const sortName = getFriendDisplaySortName(displayName)
  const firstCharacter = Array.from(sortName)[0]
  if (!firstCharacter) return '#'

  const latinLetter = getLatinLetter(firstCharacter)
  if (latinLetter && directoryLetterOrder.has(latinLetter as FriendDirectoryLetter)) {
    return latinLetter as FriendDirectoryLetter
  }

  if (isHanCharacter(firstCharacter)) {
    const pinyinInitial = getLatinLetter(getHanPinyin(firstCharacter).slice(0, 1))
    if (pinyinInitial && directoryLetterOrder.has(pinyinInitial as FriendDirectoryLetter)) {
      return pinyinInitial as FriendDirectoryLetter
    }
  }

  return '#'
}

export function getFriendSortInfo(displayName: string | null | undefined): FriendSortInfo {
  const sortName = getFriendDisplaySortName(displayName)
  const normalizedName = getNormalizedPinyin(sortName)
  return {
    sortName,
    normalizedName,
    indexLetter: getInitialLetter(sortName),
    sortKey: normalizedName || sortName.toLowerCase(),
  }
}

function stableFriendId<T extends { id: string }>(friend: T) {
  const candidate = friend as T & { uid?: unknown; userId?: unknown }
  if (typeof candidate.uid === 'number' || typeof candidate.uid === 'string') return String(candidate.uid)
  if (typeof candidate.userId === 'string' || typeof candidate.userId === 'number') return String(candidate.userId)
  return String(friend.id)
}

function compareIndexedFriends<T extends { id: string }>(left: IndexedFriend<T>, right: IndexedFriend<T>) {
  const letterDifference = (directoryLetterOrder.get(left.indexLetter) || 0) - (directoryLetterOrder.get(right.indexLetter) || 0)
  if (letterDifference) return letterDifference

  if (left.indexLetter === '#') {
    const leftIsNumber = numberPattern.test(Array.from(left.sortName)[0] || '')
    const rightIsNumber = numberPattern.test(Array.from(right.sortName)[0] || '')
    if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1
  }

  return friendDirectoryCollator.compare(left.sortKey, right.sortKey)
    || friendDirectoryCollator.compare(left.sortName, right.sortName)
    || friendDirectoryCollator.compare(stableFriendId(left), stableFriendId(right))
}

export function sortFriendsAlphabetically<T extends { id: string }>(
  friends: readonly T[],
  getDisplayName: (friend: T) => string = (friend) => {
    const candidate = friend as T & { displayName?: string | null; nickname?: string | null }
    return candidate.displayName || candidate.nickname || ''
  },
) {
  return friends
    .map((friend) => ({ ...friend, ...getFriendSortInfo(getDisplayName(friend)) }))
    .sort(compareIndexedFriends)
}

export function groupFriendsByLetter<T extends { id: string }>(
  friends: readonly T[],
  getDisplayName?: (friend: T) => string,
): FriendDirectorySection<T>[] {
  const sections = new Map<FriendDirectoryLetter, IndexedFriend<T>[]>()
  for (const friend of sortFriendsAlphabetically(friends, getDisplayName)) {
    const current = sections.get(friend.indexLetter) || []
    current.push(friend)
    sections.set(friend.indexLetter, current)
  }

  return FRIEND_DIRECTORY_LETTERS
    .filter((letter) => sections.has(letter))
    .map((letter) => ({ letter, friends: sections.get(letter) || [] }))
}

export function resolveFriendIndexTarget(
  requestedLetter: FriendDirectoryLetter,
  availableLetters: readonly FriendDirectoryLetter[],
) {
  if (!availableLetters.length) return null
  const requestedIndex = directoryLetterOrder.get(requestedLetter) || 0
  return availableLetters.find((letter) => (directoryLetterOrder.get(letter) || 0) >= requestedIndex)
    || availableLetters[availableLetters.length - 1]
}
