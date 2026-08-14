export function IpRegionLabel({ ipRegion, className = '' }: { ipRegion?: string | null; className?: string }) {
  if (!ipRegion) ipRegion = '\u672a\u6709\u8bb0\u5f55'
  return <span className={`ip-region-label text-[11px] font-bold text-slate-400 ${className}`.trim()}>IP属地：{ipRegion}</span>
}
