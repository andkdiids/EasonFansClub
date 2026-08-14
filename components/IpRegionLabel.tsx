export function IpRegionLabel({ ipRegion, className = '' }: { ipRegion?: string | null; className?: string }) {
  if (!ipRegion) return null
  return <span className={`ip-region-label text-[11px] font-bold text-slate-400 ${className}`.trim()}>IP属地：{ipRegion}</span>
}
