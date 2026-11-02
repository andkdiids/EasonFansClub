import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function assertReleaseMainBranch({ branch, expectedSha, ref }) {
  if (ref !== 'refs/heads/main') throw new Error('RELEASE_WORKFLOW_REQUIRES_MAIN')
  if (!branch || branch.name !== 'main' || branch.protected !== true) {
    throw new Error('MAIN_BRANCH_PROTECTION_REQUIRED')
  }
  if (!/^[0-9a-f]{40}$/.test(expectedSha ?? '') || branch.commit?.sha !== expectedSha) {
    throw new Error('MAIN_BRANCH_MOVED_OR_SHA_INVALID')
  }
  return { protected: true, sha: branch.commit.sha }
}

export async function verifyReleaseMainBranch({
  apiUrl = process.env.GITHUB_API_URL,
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  expectedSha = process.env.GITHUB_SHA,
  ref = process.env.GITHUB_REF,
  fetchImpl = fetch,
} = {}) {
  if (!apiUrl || repository !== 'andkdiids/EasonFansClub' || !token) {
    throw new Error('GITHUB_RELEASE_CONTEXT_INCOMPLETE')
  }

  const url = new URL(`${apiUrl}/repos/${repository}/branches/main`)
  let response
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new Error('MAIN_BRANCH_PROTECTION_LOOKUP_FAILED')
  }
  if (!response.ok) throw new Error('MAIN_BRANCH_PROTECTION_LOOKUP_FAILED')

  let branch
  try {
    branch = await response.json()
  } catch {
    throw new Error('MAIN_BRANCH_PROTECTION_LOOKUP_FAILED')
  }

  return assertReleaseMainBranch({ branch, expectedSha, ref })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  verifyReleaseMainBranch()
    .then(({ sha }) => console.log(`MAIN_BRANCH_PROTECTION=VERIFIED\nMAIN_SHA=${sha}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'MAIN_BRANCH_PROTECTION_LOOKUP_FAILED')
      process.exitCode = 1
    })
}
