export async function measureBootstrap<T>(_label: string, task: Promise<T> | (() => Promise<T>)): Promise<T> {
  return typeof task === 'function' ? task() : task
}
