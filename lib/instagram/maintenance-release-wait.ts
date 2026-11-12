/** A pending Promise and signal listeners do not keep Node's event loop alive. */
export function createMaintenanceReleaseWait(timeoutMs: number) {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  // Attach immediately: termination can arrive while drain is still running.
  void promise.catch(() => undefined)
  const deadline = setTimeout(() => reject(new Error('INSTAGRAM_MAINTENANCE_RELEASE_TIMEOUT')), timeoutMs)
  const release = () => resolve()
  const terminate = () => reject(new Error('INSTAGRAM_MAINTENANCE_TERMINATED'))
  process.once('SIGUSR2', release)
  process.once('SIGTERM', terminate)
  process.once('SIGINT', terminate)
  return {
    promise,
    dispose() {
      clearTimeout(deadline)
      process.removeListener('SIGUSR2', release)
      process.removeListener('SIGTERM', terminate)
      process.removeListener('SIGINT', terminate)
    },
  }
}
