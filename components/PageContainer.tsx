import type { ReactNode } from 'react'

type PageContainerProps = Readonly<{
  as?: 'main' | 'div' | 'section'
  id?: string
  className?: string
  children: ReactNode
}>

export function PageContainer({ as: Component = 'main', id, className = '', children }: PageContainerProps) {
  return <Component id={id} className={`page-container ${className}`.trim()}>{children}</Component>
}
