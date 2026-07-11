'use client'

export function ModuleFallback({ title = '暂时无法加载' }: { title?: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-sky-200 bg-white/70 p-6 text-center text-sm font-bold text-slate-500">
      {title}
    </div>
  )
}
