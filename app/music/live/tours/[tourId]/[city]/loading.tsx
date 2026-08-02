export default function MusicTourCityLoading() {
  return (
    <main className="min-h-screen bg-[#06101d] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-4 w-32 bg-white/10" />
        <div className="mt-8 grid gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
          <div className="aspect-square w-full max-w-[200px] bg-white/10" />
          <div className="space-y-4">
            <div className="h-3 w-40 bg-white/10" />
            <div className="h-12 w-2/3 bg-white/10" />
            <div className="h-5 w-1/2 bg-white/10" />
          </div>
        </div>
        <div className="mt-14 h-40 bg-white/[0.05]" />
      </div>
    </main>
  )
}
