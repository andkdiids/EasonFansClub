export const MAX_BULK_ATTENDANCE_SHOWS = 500

type BulkAttendanceRequest = {
  tourId?: string
  addShowIds: string[]
  removeShowIds: string[]
}

function parseIdList(value: unknown, fieldLabel: string) {
  if (value === undefined) return { ids: [] as string[] }
  if (!Array.isArray(value)) return { message: `${fieldLabel}格式不正确` }

  const ids = [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))]
  if (ids.some((id) => id.length > 100)) return { message: `${fieldLabel}包含无效场次` }
  if (ids.length > MAX_BULK_ATTENDANCE_SHOWS) return { message: `一次最多更新 ${MAX_BULK_ATTENDANCE_SHOWS} 场` }
  return { ids }
}

export function parseBulkAttendanceRequest(value: unknown): { data?: BulkAttendanceRequest; message?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { message: '批量观演记录格式不正确' }
  const body = value as Record<string, unknown>
  const tourId = body.tourId === undefined || body.tourId === null || body.tourId === ''
    ? undefined
    : typeof body.tourId === 'string' && body.tourId.trim().length <= 100
      ? body.tourId.trim()
      : undefined
  if (body.tourId !== undefined && body.tourId !== null && body.tourId !== '' && !tourId) return { message: '巡演格式不正确' }

  const additions = parseIdList(body.addShowIds, '新增场次')
  if (additions.message) return { message: additions.message }
  const removals = parseIdList(body.removeShowIds, '移除场次')
  if (removals.message) return { message: removals.message }
  const addShowIds = additions.ids || []
  const removeShowIds = removals.ids || []
  if (addShowIds.length + removeShowIds.length > MAX_BULK_ATTENDANCE_SHOWS) return { message: `一次最多更新 ${MAX_BULK_ATTENDANCE_SHOWS} 场` }

  const addSet = new Set(addShowIds)
  if (removeShowIds.some((id) => addSet.has(id))) return { message: '同一场次不能同时新增和移除' }
  return { data: { tourId, addShowIds, removeShowIds } }
}
