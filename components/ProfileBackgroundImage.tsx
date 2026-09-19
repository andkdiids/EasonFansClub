import { profileBackgroundTransformStyle, type ProfileBackgroundTransform } from '@/lib/profile-background'

export function ProfileBackgroundImage({
  sourceUrl,
  desktopTransform,
  mobileTransform,
}: {
  sourceUrl: string | null
  desktopTransform?: ProfileBackgroundTransform | null
  mobileTransform?: ProfileBackgroundTransform | null
}) {
  if (!sourceUrl) return null

  return (
    <>
      <div className="profile-background-layer profile-background-layer-mobile" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sourceUrl}
          alt=""
          className="profile-background-image"
          style={profileBackgroundTransformStyle(mobileTransform || null)}
          draggable={false}
        />
      </div>
      <div className="profile-background-layer profile-background-layer-desktop" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sourceUrl}
          alt=""
          className="profile-background-image"
          style={profileBackgroundTransformStyle(desktopTransform || null)}
          draggable={false}
        />
      </div>
    </>
  )
}
