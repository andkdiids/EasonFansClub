export function FormError({ message }: Readonly<{ message?: string }>) {
  if (!message) return null

  return <p role="alert" aria-live="polite" className="mt-2 text-sm font-semibold text-red-600">{message}</p>
}
