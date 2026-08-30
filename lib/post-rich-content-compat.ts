import { validateRichPostContent, type RichTextContent, type RichTextValidationResult } from '@/lib/rich-text'

type ResolvedPostContentInput = {
  content: string
  richContent: RichTextContent | null
  validation: RichTextValidationResult | null
  usedCompatibilityMode: boolean
}

/**
 * richContent is the canonical Post body representation. The legacy content
 * column remains a plain-text mirror for search, moderation and old clients.
 */
export const POST_RICH_CONTENT_DB_ENABLED = true

export function resolvePostContentInput(input: {
  content: unknown
  richContent: unknown
  hasRichContent: boolean
}): ResolvedPostContentInput {
  const plainContent = typeof input.content === 'string' ? input.content : ''
  if (!input.hasRichContent || input.richContent === null || input.richContent === undefined) {
    return {
      content: plainContent,
      richContent: null,
      validation: null,
      usedCompatibilityMode: false,
    }
  }

  const validation = validateRichPostContent(input.richContent)
  return {
    content: validation.valid ? validation.plainText : plainContent,
    richContent: validation.valid ? validation.value : null,
    validation,
    usedCompatibilityMode: false,
  }
}

export function logPostRichContentCompatibilityMode(operation: 'create' | 'edit', postId?: string) {
  console.info('[post.rich-content.compatibility-mode]', {
    operation,
    ...(postId ? { postId } : {}),
  })
}
