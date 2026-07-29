import type { ReactNode } from 'react'

export default function ImmersiveGameLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="immersive-game-layout" data-game-immersive="true">{children}</div>
}
