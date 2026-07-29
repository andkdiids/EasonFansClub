export function GuessFooter({ played, playCount, maxPlayCount }: Readonly<{
  played: boolean
  playCount: number
  maxPlayCount: number
}>) {
  return (
    <footer className="guess-play-footer">
      <span>{played ? '选择你认为正确的歌曲' : '点击磁带中央播放键开始试听'}</span>
      <b>本题已播放 {playCount} / {maxPlayCount} 次</b>
    </footer>
  )
}
