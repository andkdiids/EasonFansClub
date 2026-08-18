import Image from 'next/image'

export function UndercoverAvatar({ user, small = false }: { user: { name: string; avatarUrl: string | null }; small?: boolean }) {
  return user.avatarUrl ? <Image src={user.avatarUrl} alt="" width={small ? 36 : 48} height={small ? 36 : 48} unoptimized className={`${small ? 'size-9' : 'size-12'} shrink-0 rounded-full object-cover`} /> : <span className={`${small ? 'size-9' : 'size-12'} flex shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-black text-brand-700`}>{user.name.slice(0, 1)}</span>
}
