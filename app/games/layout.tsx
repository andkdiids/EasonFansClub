export default function GamesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="games-route-root games-center-background games-full-width">
      {children}
    </div>
  )
}
