export type CassetteSong = {
  id: string
  songId?: string
  title: string
  artist: string
  albumId: string
  albumTitle: string
  releaseYear: number
  language?: string | null
  coverUrl?: string | null
  previewUrl: string
  previewDuration: number
  isFullPlayback?: boolean
  canAnalyzeAudio?: boolean
}

export type CassetteMachinePhase =
  | 'idle'
  | 'dragging'
  | 'inserting'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'ejecting'
  | 'error'

export type AudioAnalysisMode = 'real' | 'fallback' | 'idle'

export type AudioAnalysisModeDetails = {
  analyserAllZero?: boolean
  hasFrequencyData?: boolean
  canAnalyzeAudio?: boolean
}
