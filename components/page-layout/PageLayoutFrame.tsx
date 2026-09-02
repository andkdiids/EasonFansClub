import type { CSSProperties, ReactNode } from 'react'
import type { PageLayoutModuleDensity } from '@/components/page-layout/PageLayoutRenderer'
import type { PageLayoutBehavior, PageLayoutModuleConfig } from '@/lib/page-layout/types'

const widthClass = {
  full: 'mx-auto w-full max-w-none',
  wide: 'mx-auto w-full max-w-6xl',
  medium: 'mx-auto w-full max-w-4xl',
  narrow: 'mx-auto w-full max-w-2xl',
  half: 'w-full md:w-[calc(50%-0.75rem)]',
  third: 'w-full md:w-[calc(33.333%-1rem)]',
}

const spacingTopClass = {
  none: 'mt-0',
  xs: 'mt-2',
  sm: 'mt-4',
  md: 'mt-6',
  lg: 'mt-8',
  xl: 'mt-12',
}

const spacingBottomClass = {
  none: 'mb-0',
  xs: 'mb-2',
  sm: 'mb-4',
  md: 'mb-6',
  lg: 'mb-8',
  xl: 'mb-12',
}

const alignmentClass = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

const densityClass = {
  compact: 'page-density-compact',
  normal: 'page-density-normal',
  spacious: 'page-density-spacious',
}

export function getPageLayoutFrameClass(config: PageLayoutModuleConfig) {
  return [
    widthClass[config.width],
    spacingTopClass[config.gapTop],
    spacingBottomClass[config.gapBottom],
    alignmentClass[config.alignment],
    densityClass[config.density],
  ].join(' ')
}

export function PageLayoutFrame({
  config,
  children,
  className = '',
  style,
  'data-grid-w': gridW,
  'data-grid-h': gridH,
  'data-layout-density': density,
  'data-layout-behavior': behavior,
  'data-layout-label': label,
}: {
  config: PageLayoutModuleConfig
  children: ReactNode
  className?: string
  style?: CSSProperties
  'data-grid-w'?: number
  'data-grid-h'?: number
  'data-layout-density'?: PageLayoutModuleDensity
  'data-layout-behavior'?: PageLayoutBehavior
  'data-layout-label'?: string
}) {
  return (
    <section
      data-layout-module={config.key}
      data-layout-label={label}
      data-grid-w={gridW}
      data-grid-h={gridH}
      data-layout-density={density}
      data-layout-behavior={behavior}
      className={`${getPageLayoutFrameClass(config)} ${className}`.trim()}
      style={style}
    >
      {children}
    </section>
  )
}
