import * as XLSX from 'xlsx'

export const MUSIC_IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024
export const MUSIC_IMPORT_MAX_ROWS_PER_SHEET = 5000
export const MUSIC_IMPORT_AUXILIARY_SHEETS = ['SongTags', 'SongMemory', 'ConcertVersion', 'Achievement'] as const

export type MusicImportFailure = {
  sheet: string
  row: number
  reason: string
}

export type MusicAlbumImportRow = {
  row: number
  name: string
  artist: string
  releaseYear: number
  language: string
  coverUrl: string | null
  description: string | null
  era: string | null
  albumType: string | null
}

export type MusicSongImportRow = {
  row: number
  title: string
  albumName: string
  trackNumber: number
  releaseYear: number
  language: string | null
  lyricist: string | null
  composer: string | null
  arranger: string | null
  producer: string | null
  story: string | null
  tags: string | null
  era: string | null
  trackType: string | null
  concertVersion: string | null
  mood: string | null
  scene: string | null
  recommendLevel: string | null
}

export type ParsedMusicImport = {
  albums: MusicAlbumImportRow[]
  songs: MusicSongImportRow[]
  failures: MusicImportFailure[]
  ignoredSheets: string[]
}

type SheetRow = Record<string, unknown>

function normalizedHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function normalizeMusicImportKey(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN')
}

function text(value: unknown, maxLength: number) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .trim()
    .slice(0, maxLength)
}

function optionalText(value: unknown, maxLength: number) {
  return text(value, maxLength) || null
}

function parseImportYear(value: unknown) {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null
}

function parseImportTrackNumber(value: unknown) {
  const trackNumber = Number(value)
  return Number.isInteger(trackNumber) && trackNumber >= 1 && trackNumber <= 999 ? trackNumber : null
}

function normalizeRow(row: SheetRow) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizedHeader(key), value])) as SheetRow
}

function getHeaders(sheet: XLSX.WorkSheet) {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: false })
  return (matrix[0] || []).map((value) => normalizedHeader(String(value ?? ''))).filter(Boolean)
}

function getRows(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: '', blankrows: false, raw: false }).map(normalizeRow)
}

function hasRequiredHeaders(headers: string[], required: string[]) {
  const keys = new Set(headers)
  return required.every((key) => keys.has(key))
}

function parseAlbumRows(rows: SheetRow[], failures: MusicImportFailure[]) {
  const albums: MusicAlbumImportRow[] = []
  rows.forEach((row, index) => {
    const rowNumber = index + 2
    const name = text(row.album_name, 160)
    const releaseYear = parseImportYear(row.release_year)
    if (!name) failures.push({ sheet: 'Albums', row: rowNumber, reason: 'album_name 不能为空' })
    if (!releaseYear) failures.push({ sheet: 'Albums', row: rowNumber, reason: 'release_year 必须是 1900 至 2100 的整数' })
    if (!name || !releaseYear) return
    albums.push({
      row: rowNumber,
      name,
      artist: text(row.artist, 100) || '陈奕迅',
      releaseYear,
      language: text(row.language, 40) || '粤语',
      coverUrl: optionalText(row.cover_url, 1000),
      description: optionalText(row.description, 10000),
      era: optionalText(row.era, 100),
      albumType: optionalText(row.album_type, 100),
    })
  })
  return albums
}

function parseSongRows(rows: SheetRow[], failures: MusicImportFailure[]) {
  const songs: MusicSongImportRow[] = []
  rows.forEach((row, index) => {
    const rowNumber = index + 2
    const title = text(row.title, 160)
    const albumName = text(row.album_name, 160)
    const trackNumber = parseImportTrackNumber(row.track_number)
    const releaseYear = parseImportYear(row.release_year)
    if (!title) failures.push({ sheet: 'Songs', row: rowNumber, reason: 'title 不能为空' })
    if (!albumName) failures.push({ sheet: 'Songs', row: rowNumber, reason: 'album_name 不能为空' })
    if (!trackNumber) failures.push({ sheet: 'Songs', row: rowNumber, reason: 'track_number 必须是 1 至 999 的整数' })
    if (!releaseYear) failures.push({ sheet: 'Songs', row: rowNumber, reason: 'release_year 必须是 1900 至 2100 的整数' })
    if (!title || !albumName || !trackNumber || !releaseYear) return
    songs.push({
      row: rowNumber,
      title,
      albumName,
      trackNumber,
      releaseYear,
      language: optionalText(row.language, 40),
      lyricist: optionalText(row.lyricist, 200),
      composer: optionalText(row.composer, 200),
      arranger: optionalText(row.arranger, 200),
      producer: optionalText(row.producer, 200),
      story: optionalText(row.story, 20000),
      tags: optionalText(row.tags, 2000),
      era: optionalText(row.era, 100),
      trackType: optionalText(row.track_type, 100),
      concertVersion: optionalText(row.concert_version, 200),
      mood: optionalText(row.mood, 200),
      scene: optionalText(row.scene, 200),
      recommendLevel: optionalText(row.recommend_level, 100),
    })
  })
  return songs
}

function findSheetName(workbook: XLSX.WorkBook, expected: string) {
  return workbook.SheetNames.find((name) => name.trim().toLowerCase() === expected.toLowerCase()) || null
}

export function parseMusicImportWorkbook(fileName: string, data: ArrayBuffer): ParsedMusicImport {
  const extension = fileName.toLowerCase().slice(fileName.lastIndexOf('.'))
  if (extension !== '.xlsx' && extension !== '.csv') throw new Error('仅支持 .xlsx 或 .csv 文件')

  const workbook = XLSX.read(new Uint8Array(data), {
    type: 'array',
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
    dense: true,
    sheetRows: MUSIC_IMPORT_MAX_ROWS_PER_SHEET + 2,
  })
  const failures: MusicImportFailure[] = []
  const ignoredSheets = workbook.SheetNames.filter((name) => MUSIC_IMPORT_AUXILIARY_SHEETS.some((expected) => expected.toLowerCase() === name.trim().toLowerCase()))
  let albumSheetName = findSheetName(workbook, 'Albums')
  let songSheetName = findSheetName(workbook, 'Songs')

  if (extension === '.csv' && workbook.SheetNames[0]) {
    const sheetName = workbook.SheetNames[0]
    const headers = getHeaders(workbook.Sheets[sheetName])
    if (headers.includes('title') && headers.includes('album_name')) songSheetName = sheetName
    else if (headers.includes('album_name')) albumSheetName = sheetName
  }

  if (!albumSheetName && !songSheetName) {
    return { albums: [], songs: [], failures: [{ sheet: '文件', row: 1, reason: '未找到 Albums 或 Songs 数据表' }], ignoredSheets }
  }

  let albums: MusicAlbumImportRow[] = []
  let songs: MusicSongImportRow[] = []

  if (albumSheetName) {
    const sheet = workbook.Sheets[albumSheetName]
    const headers = getHeaders(sheet)
    const rows = getRows(sheet)
    if (!hasRequiredHeaders(headers, ['album_name', 'release_year'])) failures.push({ sheet: 'Albums', row: 1, reason: '缺少必填表头 album_name 或 release_year' })
    else if (rows.length > MUSIC_IMPORT_MAX_ROWS_PER_SHEET) failures.push({ sheet: 'Albums', row: 1, reason: `单个 Sheet 最多 ${MUSIC_IMPORT_MAX_ROWS_PER_SHEET} 条数据` })
    else albums = parseAlbumRows(rows, failures)
  }

  if (songSheetName) {
    const sheet = workbook.Sheets[songSheetName]
    const headers = getHeaders(sheet)
    const rows = getRows(sheet)
    if (!hasRequiredHeaders(headers, ['title', 'album_name', 'track_number', 'release_year'])) failures.push({ sheet: 'Songs', row: 1, reason: '缺少必填表头 title、album_name、track_number 或 release_year' })
    else if (rows.length > MUSIC_IMPORT_MAX_ROWS_PER_SHEET) failures.push({ sheet: 'Songs', row: 1, reason: `单个 Sheet 最多 ${MUSIC_IMPORT_MAX_ROWS_PER_SHEET} 条数据` })
    else songs = parseSongRows(rows, failures)
  }

  return { albums, songs, failures, ignoredSheets }
}
