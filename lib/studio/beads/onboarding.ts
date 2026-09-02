export const BEAD_STUDIO_ONBOARDING_STORAGE_KEY = 'studio_beads_onboarding_seen'

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

export function hasSeenBeadStudioOnboarding(storage: ReadableStorage | null | undefined) {
  try {
    return storage?.getItem(BEAD_STUDIO_ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markBeadStudioOnboardingSeen(storage: WritableStorage | null | undefined) {
  try {
    storage?.setItem(BEAD_STUDIO_ONBOARDING_STORAGE_KEY, '1')
  } catch {
    // Private browsing and storage quotas must not interrupt the editor.
  }
}
