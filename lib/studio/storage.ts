import type { StudioLocalProject, StudioProjectData, StudioProjectSummary, StudioRecentTool } from './types'

const DB_NAME = 'eason-studio-local'
const DB_VERSION = 1
const PROJECT_STORE = 'projects'
const DRAFT_STORE = 'drafts'
const PROJECT_INDEX_KEY = 'eason-studio-project-index-v1'
const RECENT_KEY = 'eason-studio-recent-v1'
const DRAFT_KEY_PREFIX = 'draft:'

function hasIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota and privacy-mode failures should not break the editor.
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

async function putRecord(storeName: string, value: unknown, key?: string) {
  const db = await openDatabase()
  if (!db) return false
  return new Promise<boolean>((resolve) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = key ? store.put(value, key) : store.put(value)
    request.onsuccess = () => resolve(true)
    request.onerror = () => resolve(false)
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => resolve(false)
  })
}

async function getRecord<T>(storeName: string, key: string) {
  const db = await openDatabase()
  if (!db) return null
  return new Promise<T | null>((resolve) => {
    const transaction = db.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).get(key)
    request.onsuccess = () => resolve((request.result as T | undefined) || null)
    request.onerror = () => resolve(null)
    transaction.oncomplete = () => db.close()
  })
}

async function deleteRecord(storeName: string, key: string) {
  const db = await openDatabase()
  if (!db) return false
  return new Promise<boolean>((resolve) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const request = transaction.objectStore(storeName).delete(key)
    request.onsuccess = () => resolve(true)
    request.onerror = () => resolve(false)
    transaction.oncomplete = () => db.close()
  })
}

export function createStudioId() {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `local-${Date.now().toString(36)}-${random}`
}

function projectIndex(): StudioProjectSummary[] {
  return readJson<StudioProjectSummary[]>(PROJECT_INDEX_KEY, [])
    .filter((project) => project && typeof project.id === 'string')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function writeProjectIndex(projects: StudioProjectSummary[]) {
  writeJson(PROJECT_INDEX_KEY, projects.slice(0, 100))
}

export async function getLocalStudioProject(id: string) {
  return getRecord<StudioLocalProject>(PROJECT_STORE, id)
}

export function listLocalStudioProjects() {
  return projectIndex()
}

export async function saveLocalStudioProject(project: StudioLocalProject) {
  const summary: StudioProjectSummary = {
    id: project.id,
    toolSlug: project.toolSlug,
    title: project.title,
    description: project.description,
    version: project.version,
    thumbnailUrl: project.thumbnailUrl,
    visibility: project.visibility,
    reviewStatus: project.reviewStatus,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
    metadata: project.metadata,
  }
  const saved = await putRecord(PROJECT_STORE, project)
  const projects = projectIndex().filter((item) => item.id !== project.id)
  projects.unshift(summary)
  writeProjectIndex(projects)
  return saved
}

export async function deleteLocalStudioProject(id: string) {
  const deleted = await deleteRecord(PROJECT_STORE, id)
  writeProjectIndex(projectIndex().filter((project) => project.id !== id))
  return deleted
}

export async function readStudioDraft<T extends StudioProjectData>(toolSlug: string) {
  const fromIndexedDb = await getRecord<T>(DRAFT_STORE, `${DRAFT_KEY_PREFIX}${toolSlug}`)
  if (fromIndexedDb) return fromIndexedDb
  return readJson<T | null>(`${DRAFT_KEY_PREFIX}${toolSlug}`, null)
}

export async function writeStudioDraft(toolSlug: string, data: StudioProjectData) {
  const saved = await putRecord(DRAFT_STORE, data, `${DRAFT_KEY_PREFIX}${toolSlug}`)
  if (!saved) writeJson(`${DRAFT_KEY_PREFIX}${toolSlug}`, data)
  return saved
}

export function clearStudioDraft(toolSlug: string) {
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(`${DRAFT_KEY_PREFIX}${toolSlug}`) } catch { /* noop */ }
  }
  void deleteRecord(DRAFT_STORE, `${DRAFT_KEY_PREFIX}${toolSlug}`)
}

export function recordStudioEvent(toolSlug: string, event: StudioRecentTool['event']) {
  const recent = readJson<StudioRecentTool[]>(RECENT_KEY, [])
  recent.unshift({ toolSlug, event, occurredAt: new Date().toISOString() })
  writeJson(RECENT_KEY, recent.slice(0, 30))
}

export function listRecentStudioEvents() {
  return readJson<StudioRecentTool[]>(RECENT_KEY, [])
}
