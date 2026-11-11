export async function runUnlessDeploymentHeld<T>(isHeld: () => boolean, run: () => Promise<T>) {
  if (isHeld()) return { held: true as const }
  return { held: false as const, result: await run() }
}
