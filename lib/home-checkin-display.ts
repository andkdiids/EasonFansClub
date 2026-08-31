export type HomeCheckInDisplay =
  | { status: 'loading'; todayCheckInCount: null }
  | { status: 'not-checked-in'; todayCheckInCount: null }
  | { status: 'checked-in'; todayCheckInCount: number }

export function getHomeCheckInDisplay(input: {
  loaded: boolean
  checkedInToday: boolean
  todayCheckInCount: number
}): HomeCheckInDisplay {
  if (!input.loaded) return { status: 'loading', todayCheckInCount: null }
  if (!input.checkedInToday) return { status: 'not-checked-in', todayCheckInCount: null }
  return { status: 'checked-in', todayCheckInCount: input.todayCheckInCount }
}
