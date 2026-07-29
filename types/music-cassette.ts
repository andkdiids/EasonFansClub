export type CassetteSong = {
  id: string
  title: string
  artist: string
  albumId: string
  albumTitle: string
  releaseYear: number
  language?: string | null
  coverUrl?: string | null
  previewUrl: string
  previewDuration: number
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
