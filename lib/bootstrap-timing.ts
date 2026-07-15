export async function measureBootstrap<T>(label: string, task: Promise<T> | (() => Promise<T>)): Promise<T> {
  const startedAt = Date.now()
  try {
    return await (typeof task === 'function' ? task() : task)
  } finally {
    console.info(`[bootstrap] ${label} ${Date.now() - startedAt}ms`)
  }
}
