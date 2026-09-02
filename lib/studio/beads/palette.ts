import { paletteColor } from './color'
import type { BeadPaletteColor } from './types'

type PaletteSpec = { code: string; name: string; hex: string }

const baseColors: PaletteSpec[] = [
  { code: 'A01', name: '白色', hex: '#FFFFFF' },
  { code: 'A02', name: '象牙白', hex: '#F4EBD0' },
  { code: 'A03', name: '浅灰', hex: '#C8CDD2' },
  { code: 'A04', name: '黑色', hex: '#22252A' },
  { code: 'A05', name: '深灰', hex: '#626A72' },
  { code: 'B01', name: '红色', hex: '#D9363E' },
  { code: 'B02', name: '珊瑚红', hex: '#F26B5E' },
  { code: 'B03', name: '橙色', hex: '#F28C28' },
  { code: 'B04', name: '黄色', hex: '#F5C542' },
  { code: 'B05', name: '奶油黄', hex: '#FFE9A8' },
  { code: 'C01', name: '草绿色', hex: '#65A85A' },
  { code: 'C02', name: '薄荷绿', hex: '#9DD9B5' },
  { code: 'C03', name: '青绿色', hex: '#2F9C95' },
  { code: 'C04', name: '天蓝色', hex: '#66B6E3' },
  { code: 'C05', name: '湖蓝色', hex: '#2D7DB3' },
  { code: 'C06', name: '深蓝色', hex: '#1D3F73' },
  { code: 'D01', name: '紫色', hex: '#7950A8' },
  { code: 'D02', name: '薰衣草', hex: '#B9A4D6' },
  { code: 'D03', name: '粉色', hex: '#E892B6' },
  { code: 'D04', name: '棕色', hex: '#8B5E3C' },
  { code: 'D05', name: '沙色', hex: '#D6B98C' },
  { code: 'E01', name: '肤色', hex: '#F2C6A0' },
  { code: 'E02', name: '酒红', hex: '#7B2536' },
  { code: 'E03', name: '荧光绿', hex: '#B7D53B' },
]

const brandSeries: Record<string, string[]> = {
  MARD: ['291', '221'],
  Perler: ['Standard'],
  Hama: ['Midi'],
  Artkal: ['S-Series'],
}

const brandPrefixes: Record<string, string> = {
  MARD: '',
  Perler: 'P',
  Hama: 'H',
  Artkal: 'K',
}

const paletteCache = new Map<string, BeadPaletteColor[]>()

export function getPalette(brand: string, series: string) {
  const key = `${brand}:${series}`
  const cached = paletteCache.get(key)
  if (cached) return cached
  const prefix = brandPrefixes[brand] || ''
  const palette = baseColors.map((color) => paletteColor(brand, series, `${prefix}${color.code}`, color.name, color.hex))
  paletteCache.set(key, palette)
  return palette
}

export function getSeriesForBrand(brand: string) {
  return brandSeries[brand] || []
}

export function getDefaultPalette() {
  return getPalette('MARD', '291')
}

export const supportedBeadBrands = Object.keys(brandSeries)
