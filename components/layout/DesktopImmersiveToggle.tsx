'use client'

export function DesktopImmersiveToggle({ visible, collapsed, onToggle }: Readonly<{
  visible: boolean
  collapsed: boolean
  onToggle: () => void
}>) {
  return (
    <button
      type="button"
      className="desktop-immersive-toggle"
      data-visible={visible ? 'true' : 'false'}
      data-sidebar-collapsed={collapsed ? 'true' : 'false'}
      aria-hidden={!visible}
      aria-label={collapsed ? '展开左侧导航' : '收起左侧导航'}
      aria-expanded={!collapsed}
      tabIndex={visible ? 0 : -1}
      disabled={!visible}
      onClick={onToggle}
    >
      {collapsed ? '>>' : '<<'}
    </button>
  )
}
