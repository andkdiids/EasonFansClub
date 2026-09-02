export type IconName = 'home' | 'forum' | 'music' | 'calendar' | 'archive' | 'activity' | 'bell' | 'star' | 'check' | 'chart' | 'friends' | 'log' | 'feedback' | 'help' | 'settings' | 'logout' | 'search' | 'edit' | 'grid' | 'menu' | 'user' | 'arrow-up' | 'sticker' | 'stethoscope' | 'pill' | 'gift' | 'camera' | 'eye' | 'palette'

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></>,
  forum: <><path d="M4 5h16v11H8l-4 4Z"/><path d="M8 9h8M8 12h5"/></>,
  music: <><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16"/><path d="M7 3v4m10-4v4M3 10h18"/></>,
  archive: <><path d="M4 7h16v13H4zM3 3h18v4H3z"/><path d="M9 11h6"/></>,
  activity: <path d="M3 12h4l2-6 4 12 2-6h6"/>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>,
  check: <><rect x="4" y="3" width="16" height="18"/><path d="M8 3v3h8V3m-8 11 3 3 5-6"/></>,
  chart: <><path d="M4 20V10h4v10m4 0V4h4v16m4 0V8"/></>,
  friends: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2"/><path d="M3 20c0-4 2-7 6-7s6 3 6 7m0-5c3 0 5 2 5 5"/></>,
  log: <><path d="M5 4h14v16H5z"/><path d="M8 8h8m-8 4h8m-8 4h5"/></>,
  feedback: <><path d="M4 5h16v12H8l-4 4Z"/><path d="M12 8v4m0 3h.01"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.1 2.3c-.9.4-.9 1-.9 1.7m0 3h.01"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
  logout: <><path d="M10 4H4v16h6m5-4 4-4-4-4m4 4H9"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  edit: <><path d="M4 20h4L20 8l-4-4L4 16z"/><path d="m14 6 4 4"/></>,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M17 14v6m-3-3h6"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-5 3-8 8-8s8 3 8 8"/></>,
  'arrow-up': <><path d="m6 10 6-6 6 6"/><path d="M12 4v16"/></>,
  sticker: <><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9.5" cy="10" r="1"/><circle cx="14.5" cy="10" r="1"/><path d="M9 14.5a3.5 3.5 0 0 0 6 0"/></>,
  stethoscope: <><path d="M6 3v5a4 4 0 0 0 8 0V3"/><path d="M6 3H4m10 0h2"/><path d="M10 12v2a5 5 0 0 0 10 0v-1"/><circle cx="20" cy="10" r="2"/></>,
  pill: <><path d="m7 17 10-10a4.24 4.24 0 0 1 6 6L13 23a4.24 4.24 0 0 1-6-6Z"/><path d="m9.5 14.5 6 6"/></>,
  gift: <><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8H8.5a2.5 2.5 0 1 1 2.5-2.5V8Zm0 0h3.5a2.5 2.5 0 1 0-2.5-2.5V8Z"/></>,
  camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.5"/></>,
  eye: <><path d="M2.5 12s3.2-5 9.5-5 9.5 5 9.5 5-3.2 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.2"/></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18h1.3a1.8 1.8 0 0 0 0-3.6h-.8a1.7 1.7 0 0 1 0-3.4H15a6 6 0 0 0 0-12Z"/><circle cx="7.5" cy="10" r=".8" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r=".8" fill="currentColor" stroke="none"/><circle cx="14" cy="7" r=".8" fill="currentColor" stroke="none"/></>,
}

export function UiIcon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
