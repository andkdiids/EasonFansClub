import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = '/home/apps/easonfansclub'
export const TARGETS = [`${APP}/releases`, `${APP}/shared`]
export function repairPermissions(expectedSha, io = fs) {
  if (!/^[0-9a-f]{40}$/.test(expectedSha || '')) throw Error('EXPECTED_SHA_INVALID')
  const current = `${APP}/current`
  if (!io.lstatSync(current).isSymbolicLink()) throw Error('CURRENT_NOT_SYMLINK')
  const release = path.posix.resolve(APP, io.readlinkSync(current))
  if (!new RegExp(`^${APP}/releases/[A-Za-z0-9._-]+$`).test(release)) throw Error('RELEASE_PATH_INVALID')
  if (io.readFileSync(`${release}/.deployed-sha`, 'utf8').trim() !== expectedSha) throw Error('PRODUCTION_SHA_CAS_MISMATCH')
  for (const name of TARGETS) {
    const stat = io.lstatSync(name)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 1000 || stat.gid !== 1001 || (stat.mode & 0o7777) !== 0o775) throw Error('DIRECTORY_METADATA_CAS_MISMATCH')
  }
  const changed = []
  try {
    for (const name of TARGETS) {
      io.chmodSync(name, 0o755)
      changed.push(name)
      if ((io.lstatSync(name).mode & 0o7777) !== 0o755) throw Error('MODE_VERIFICATION_FAILED')
    }
    if (path.posix.resolve(APP, io.readlinkSync(current)) !== release || io.readFileSync(`${release}/.deployed-sha`, 'utf8').trim() !== expectedSha) throw Error('PRODUCTION_CHANGED')
    return { result: 'DIRECTORY_PERMISSIONS_REPAIRED', expectedSha, paths: TARGETS, oldMode: '0775', newMode: '0755', recursive: false, databaseWrites: 'NONE' }
  } catch (error) {
    for (const name of changed.reverse()) {
      const stat = io.lstatSync(name)
      if (stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 1000 && stat.gid === 1001 && (stat.mode & 0o7777) === 0o755) io.chmodSync(name, 0o775)
    }
    throw error
  }
}
if (process.argv[1] === '-' || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(repairPermissions(process.argv[2]))) }
  catch (error) { console.log(JSON.stringify({ result: 'FAILED_CLOSED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'PERMISSION_REPAIR_FAILED' })); process.exitCode = 1 }
}
