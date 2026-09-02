import type { StudioProjectSummary } from './types'

export function studioProjectEditorPath(project: Pick<StudioProjectSummary, 'id' | 'toolSlug'>) {
  return `/studio/${encodeURIComponent(project.toolSlug)}?project=${encodeURIComponent(project.id)}`
}
