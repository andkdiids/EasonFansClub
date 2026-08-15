/**
 * The system Emoji catalog used by the site's existing EmojiPicker.
 * Keep this as the single source of truth for UI choices and server-side
 * custom-mood validation. User-uploaded stickers are intentionally excluded.
 */
export const EMOJI_CATEGORIES = [
  {
    label: '常用表情',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '🥰', '😍', '😘', '😎', '🤔', '🥹', '😭', '😢', '😡', '😱', '😴', '🙄', '😮', '🥲', '😇', '🙂', '🙃', '😉', '😌', '😋', '🤭', '🫢', '🫣'],
  },
  {
    label: '爱心系列',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '🩷', '🩵', '🩶', '💕', '💖', '💗', '💓', '💞', '💘', '💝', '💟', '❣️', '❤️‍🔥', '❤️‍🩹', '💔', '💌'],
  },
  {
    label: '互动表情',
    emojis: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '👌', '✌️', '👀', '🔥', '🎉', '💯', '✨', '🤞', '🤟', '🤘', '👊', '✊', '🤛', '🤜', '👋', '🫶', '💪', '🫡', '🤙', '☝️', '👇', '👉', '👈', '👐'],
  },
  {
    label: '可爱动物',
    emojis: ['🐱', '🐶', '🐰', '🐻', '🐼', '🐸', '🦊', '🐨', '🐯', '🐷', '🐹', '🐭', '🐮', '🦁', '🐵', '🐧', '🐦', '🐥', '🦄', '🐝', '🦋', '🐢', '🐬', '🐳', '🦦'],
  },
  {
    label: '音乐与E院',
    emojis: ['🎵', '🎶', '🎤', '🎧', '⭐', '✨', '🌟', '🌙', '💫', '🚑', '💙', '🏥', '🩺', '💊', '🩹', '🎼', '🎹', '🥁', '🎸', '🎺', '🎻', '📻', '💿', '📀', '🎙️', '🎚️', '🎛️'],
  },
  {
    label: '网络常用',
    emojis: ['🥳', '🤩', '😆', '😅', '🤣', '🥲', '😇', '😜', '😝', '🤗', '🤓', '🧐', '🤪', '😏', '😬', '🫠', '🫥', '🫤', '🥺', '😤', '🤯', '🥶', '🥵', '🤤', '🤫', '🫨', '💀', '👻', '👽', '🤖', '💩', '🌈', '☀️', '☁️', '🍀'],
  },
] as const

export const SYSTEM_EMOJIS = [...new Set(EMOJI_CATEGORIES.flatMap((category) => category.emojis))]
export const SYSTEM_EMOJI_SET = new Set<string>(SYSTEM_EMOJIS)
export const SYSTEM_EMOJI_COUNT = SYSTEM_EMOJIS.length

export function isAllowedSystemEmoji(value: unknown): value is string {
  return typeof value === 'string' && SYSTEM_EMOJI_SET.has(value)
}
