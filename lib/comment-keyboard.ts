export type CommentKeyboardEventLike = {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  isComposing?: boolean
  keyCode?: number
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
  }
}

export function shouldSubmitCommentOnEnter(
  event: CommentKeyboardEventLike,
  options: Readonly<{
    isDesktop: boolean
    canSubmit: boolean
    suggestionOpen?: boolean
    isComposing?: boolean
  }>,
) {
  const composing = Boolean(
    event.isComposing
    || event.nativeEvent?.isComposing
    || event.keyCode === 229
    || event.nativeEvent?.keyCode === 229
    || options.isComposing,
  )

  return Boolean(
    options.isDesktop
    && options.canSubmit
    && !options.suggestionOpen
    && event.key === 'Enter'
    && !event.shiftKey
    && !event.ctrlKey
    && !event.metaKey
    && !composing,
  )
}
