export default function GamesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="games-center-background games-full-width">
      {children}
    </div>
  )
}