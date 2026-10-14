export type TopicActivityFormSort = 'OLDEST' | 'NEWEST'
type FormCursor = { submittedAt: Date; id: string; sort?: TopicActivityFormSort }

export function encodeTopicActivityFormCursor(row: { submittedAt: Date; id: string }, sort?: TopicActivityFormSort) {
  return Buffer.from(JSON.stringify({ submittedAt: row.submittedAt.toISOString(), id: row.id, ...(sort ? { sort } : {}) })).toString('base64url')
}

export function decodeTopicActivityFormCursor(value: string): FormCursor | null {
  if (!value || value.length > 700 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const row = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(row.id) || typeof row.submittedAt !== 'string') return null
    const submittedAt = new Date(row.submittedAt)
    if (!Number.isFinite(submittedAt.getTime()) || submittedAt.toISOString() !== row.submittedAt) return null
    if (row.sort !== undefined && row.sort !== 'OLDEST' && row.sort !== 'NEWEST') return null
    return { id: row.id, submittedAt, ...(row.sort ? { sort: row.sort } : {}) }
  } catch { return null }
}
