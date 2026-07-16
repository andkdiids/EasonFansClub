export const PAGE_LAYOUT_ROW_HEIGHT = 80
export const PAGE_LAYOUT_ROW_GAP = 12

export function gridHeightToPixels(height: number) {
  const rows = Math.max(1, Math.floor(height))
  return rows * PAGE_LAYOUT_ROW_HEIGHT + Math.max(0, rows - 1) * PAGE_LAYOUT_ROW_GAP
}

export function pixelsToGridHeight(height: number) {
  return Math.max(1, Math.ceil((height + PAGE_LAYOUT_ROW_GAP) / (PAGE_LAYOUT_ROW_HEIGHT + PAGE_LAYOUT_ROW_GAP)))
}
