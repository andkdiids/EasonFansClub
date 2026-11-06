export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError('maxConcurrency must be a positive safe integer')
  }

  const results = new Array<R>(items.length)
  let nextIndex = 0
  const failures: unknown[] = []
  const workerCount = Math.min(items.length, maxConcurrency)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (failures.length === 0) {
      const index = nextIndex++
      if (index >= items.length) return
      try {
        results[index] = await mapper(items[index], index)
      } catch (error) {
        failures.push(error)
        return
      }
    }
  }))

  if (failures.length > 0) throw failures[0]
  return results
}