export type CantoneseTeachingEditValues = {
  title: string
  body: string
  displayText: string
  jyutping: string
  translation: string
  explanation: string
  usageNote: string
}

type EditableTeachingField = keyof CantoneseTeachingEditValues

const requiredFields: readonly EditableTeachingField[] = ['title', 'body']
const nullableFields: readonly EditableTeachingField[] = ['displayText', 'jyutping', 'translation', 'explanation', 'usageNote']
const editableFields: readonly EditableTeachingField[] = [...requiredFields, ...nullableFields]

function normalized(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Build the sparse teaching edit contract used by the admin review route.
 * Empty nullable values are intentionally represented as null so a clear is
 * distinguishable from an omitted field. Metadata and review-only fields are
 * never copied from the list item into this payload.
 */
export function buildCantoneseTeachingEditPayload(
  original: Record<string, unknown>,
  values: Partial<CantoneseTeachingEditValues>,
) {
  const payload: Record<string, unknown> = { action: 'edit' }
  for (const field of editableFields) {
    if (!Object.prototype.hasOwnProperty.call(values, field)) continue
    const before = normalized(original[field])
    const after = normalized(values[field])
    if (before === after) continue
    payload[field] = nullableFields.includes(field) ? after || null : after
  }
  return payload
}

export function hasCantoneseTeachingEditChanges(payload: Record<string, unknown>) {
  return Object.keys(payload).some((key) => key !== 'action')
}
