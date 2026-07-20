// EasMusic 轮播循环索引工具(纯函数,可直接单元测试)

/** 将任意整数索引归一化到 [0, total),例如 last + 1 -> 0、0 - 1 -> last */
export function normalizeIndex(index: number, total: number) {
  if (total <= 0) return 0
  return ((Math.round(index) % total) + total) % total
}

/** 将连续浮点位置归一化到 [0, total);配合 getWrappedOffset 时归一化前后视觉位置完全一致 */
export function normalizePosition(position: number, total: number) {
  if (total <= 0) return 0
  return ((position % total) + total) % total
}

/**
 * 卡片相对循环位置的最短距离,结果恒在 [-total/2, total/2)。
 * position 可以是任意连续浮点值(小于 0 或大于 total 都安全),
 * 首尾交界处的卡片会被映射到另一侧,保证当前中心卡 offset 最接近 0。
 */
export function getWrappedOffset(cardIndex: number, position: number, total: number) {
  if (total <= 0) return 0
  const raw = cardIndex - position
  return ((((raw + total / 2) % total) + total) % total) - total / 2
}
