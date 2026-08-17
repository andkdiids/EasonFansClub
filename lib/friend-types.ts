export type RelationshipStatus =
  | 'FRIEND'
  | 'OUTGOING_PENDING'
  | 'INCOMING_PENDING'
  | 'NONE'
  | 'SELF'
  | 'BLOCKED'

export type UndercoverPresence = {
  status: 'WAITING' | 'PLAYING'
  roomId: string
  roomCode: string
  canJoin: boolean
  requiresPassword: boolean
}

export type FriendDockUser = {
  id: string
  uid: number
  nickname: string
  avatarUrl: string | null
  bio: string | null
  isOnline: boolean
  lastActiveAt: string | null
  createdAt: string
  level: number
  levelName: string
  groupId?: string | null
  profile: {
    displayName: string | null
    avatarUrl: string | null
    bio: string | null
  } | null
  relationshipStatus?: RelationshipStatus
  requestId?: string | null
  conversationId?: string | null
  unreadCount?: number
  lastMessageAt?: string | null
  lastMessage?: {
    id: string
    content: string
    createdAt: string
    senderId: string
    type?: string | null
  } | null
  undercoverPresence?: UndercoverPresence | null
}
