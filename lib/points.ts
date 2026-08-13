export const POINTS = {
  dailyCheckInMin: 3,
  dailyCheckInMax: 7,
}

export function getRandomCheckInPoints() {
  return Math.floor(Math.random() * (POINTS.dailyCheckInMax - POINTS.dailyCheckInMin + 1)) + POINTS.dailyCheckInMin
}

export function calcLevel(points: number) {
  if (points >= 2000) return 6
  if (points >= 1000) return 5
  if (points >= 500) return 4
  if (points >= 200) return 3
  if (points >= 50) return 2
  return 1
}
