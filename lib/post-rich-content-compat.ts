import { validateRichPostContent } from '@/lib/rich-text'

/**
 * The application schema already knows about richContent, but production has
 * not applied that additive migration yet. Keep the database dependency
 * explicitly disabled until the migration is reviewed and deployed.
 */
export const POST_RICH_CONTENT_DB_ENABLED = false

export function resolvePostContentInput(input: {
  content: unknown
  richContent: unknown
  hasRichContent: boolean
}) {
  const plainContent = typeof input.content === 'string' ? input.content : ''
  if (!input.hasRichContent || input.richContent === null || input.richContent === undefined) {
    return {
      content: plainContent,
      validation: null,
      usedCompatibilityMode: false,
    }
  }

  const validation = validateRichPostContent(input.richContent)
  return {
    content: validation.valid ? validation.plainText : plainContent,
    validation,
    usedCompatibilityMode: !POST_RICH_CONTENT_DB_ENABLED,
  }
}

export function logPostRichContentCompatibilityMode(operation: 'create' | 'edit', postId?: string) {
  console.info('[post.rich-content.compatibility-mode]', {
    operation,
    ...(postId ? { postId } : {}),
  })
}
