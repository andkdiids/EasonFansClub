import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP = '/home/apps/easonfansclub'
export function inspectPermissions(io = fs) {
  const fixed = ['/', '/home', '/home/apps', APP, `${APP}/releases`, `${APP}/shared`]
  const rows = []
  for (const name of fixed) {
    try {
      const stat = io.lstatSync(name)
      rows.push({ path: name, uid: stat.uid, gid: stat.gid, mode: (stat.mode & 0o7777).toString(8), directory: stat.isDirectory(), symlink: stat.isSymbolicLink(), groupOrOtherWritable: Boolean(stat.mode & 0o022) })
    } catch { rows.push({ path: name, status: 'UNKNOWN' }) }
  }
  try {
    const link = `${APP}/current`
    if (!io.lstatSync(link).isSymbolicLink()) throw Error('NOT_SYMLINK')
    const target = path.posix.resolve(APP, io.readlinkSync(link))
    if (!new RegExp(`^${APP}/releases/[A-Za-z0-9._-]+$`).test(target) || ['.', '..'].includes(path.posix.basename(target))) throw Error('UNSAFE_TARGET')
    const stat = io.lstatSync(target)
    rows.push({ path: target, uid: stat.uid, gid: stat.gid, mode: (stat.mode & 0o7777).toString(8), directory: stat.isDirectory(), symlink: stat.isSymbolicLink(), groupOrOtherWritable: Boolean(stat.mode & 0o022) })
  } catch { rows.push({ path: `${APP}/current`, status: 'UNKNOWN' }) }
  return { scope: 'FIXED_DIRECTORY_METADATA_ONLY', productionWrites: 'NONE', envContentRead: false, observedAt: new Date().toISOString(), rows }
}
if (process.argv[1] === '-' || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) console.log(JSON.stringify(inspectPermissions()))
