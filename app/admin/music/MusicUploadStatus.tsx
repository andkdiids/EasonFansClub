import type { MusicUploadStage } from '@/app/admin/music/music-upload-client'

const stageOrder: MusicUploadStage[] = ['selected', 'processing', 'uploading', 'converting', 'complete']

export function MusicUploadStatus({
  stage,
  conversionLabel,
}: Readonly<{
  stage: MusicUploadStage
  conversionLabel: string
}>) {
  if (stage === 'idle' || stage === 'error') return null
  const activeIndex = stageOrder.indexOf(stage)
  const labels = ['已选择文件', '校验处理中', '上传中', conversionLabel, '完成']
  return (
    <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="上传进度" aria-live="polite">
      {labels.map((label, index) => (
        <li
          key={label}
          className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
            index <= activeIndex ? 'bg-brand-700 text-white' : 'bg-white text-slate-400'
          }`}
          aria-current={index === activeIndex ? 'step' : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  )
}
