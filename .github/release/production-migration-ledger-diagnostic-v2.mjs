import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

export const CANDIDATE_SHA = '2b6d06b630dfed7e8ce6e518e10bda52b919af8b'
export const EXPECTED_PRODUCTION_SHA = '1a0c8b9d85c7aa61f5a70e37bcdee563b5bff063'
export const APP_ROOT = '/home/apps/easonfansclub'
export const MIGRATIONS = Object.freeze([
  '20260815090000_add_song_ratings',
  '20260816120000_add_want_listen_game',
  '20260820140000_add_want_listen_session_exclusion',
  '20260821120000_add_rate_limit_log',
  '20260826100000_add_anywhere_door_social_posts',
  '20260827100000_add_anywhere_door_safety_state',
])

const LEDGER_FIELDS = Object.freeze([
  ['id', 'id'],
  ['migration_name', 'migration_name'],
  ['checksum', 'checksum'],
  ['started_at', 'started_at'],
  ['finished_at', 'finished_at'],
  ['rolled_back_at', 'rolled_back_at'],
  ['applied_steps_count', 'applied_steps_count'],
  ['logs', 'logs_status'],
])
const MAX_SQL_BYTES = 4 * 1024 * 1024

export class DiagnosticFailure extends Error {
  constructor(code) {
    super(code)
    this.name = 'DiagnosticFailure'
    this.code = code
  }
}

function requireThat(condition, code) {
  if (!condition) throw new DiagnosticFailure(code)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeHost(host) {
  return /^[A-Za-z0-9._-]+$/.test(host) || /^\[[A-Fa-f0-9:]+\]$/.test(host)
}

export function validateHostIdentity({ host, user, port, sshKey, pinnedHosts, pinnedFingerprint }) {
  requireThat(typeof host === 'string' && safeHost(host), 'SSH_HOST_INVALID')
  requireThat(typeof user === 'string' && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(user), 'SSH_USER_INVALID')
  requireThat(typeof port === 'string' && /^[0-9]{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535, 'SSH_PORT_INVALID')
  requireThat(typeof sshKey === 'string' && sshKey.trim().length > 0, 'SSH_KEY_MISSING')
  requireThat(typeof pinnedFingerprint === 'string' && /^SHA256:[A-Za-z0-9+/]+=?$/.test(pinnedFingerprint), 'HOST_FINGERPRINT_MISSING')
  requireThat(typeof pinnedHosts === 'string' && pinnedHosts.trim().length > 0, 'PINNED_HOSTS_MISSING')

  const lines = pinnedHosts.trim().split(/\r?\n/)
  const fields = lines.length === 1 ? lines[0].trim().split(/\s+/) : []
  const hostToken = port === '22' ? host : `[${host}]:${port}`
  requireThat(fields.length === 3 && fields[0] === hostToken, 'HOST_BINDING_INVALID')
  requireThat(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))$/.test(fields[1]), 'HOST_KEY_TYPE_INVALID')
  requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(fields[2]), 'HOST_KEY_ENCODING_INVALID')

  const keyBytes = Buffer.from(fields[2], 'base64')
  requireThat(keyBytes.length > 0 && keyBytes.toString('base64').replace(/=+$/, '') === fields[2].replace(/=+$/, ''), 'HOST_KEY_ENCODING_INVALID')
  const actualFingerprint = `SHA256:${createHash('sha256').update(keyBytes).digest('base64').replace(/=+$/, '')}`
  requireThat(actualFingerprint === pinnedFingerprint, 'HOST_FINGERPRINT_MISMATCH')
  return { verified: true }
}

function stripComments(sql) {
  let output = ''
  let state = ''
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]
    const next = sql[i + 1]
    if (state) {
      output += char
      if (state !== '`' && char === '\\' && next) {
        output += next
        i += 1
      } else if (char === state) {
        if (next === state) {
          output += next
          i += 1
        } else {
          state = ''
        }
      }
      continue
    }
    if (char === '`' || char === "'" || char === '"') {
      state = char
      output += char
      continue
    }
    if ((char === '-' && next === '-' && /\s/.test(sql[i + 2] || ' ')) || char === '#') {
      while (i < sql.length && sql[i] !== '\n') i += 1
      output += '\n'
      continue
    }
    if (char === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] === '\n') output += '\n'
        i += 1
      }
      requireThat(i < sql.length, 'SQL_COMMENT_UNTERMINATED')
      i += 1
      continue
    }
    output += char
  }
  requireThat(!state, 'SQL_QUOTE_UNTERMINATED')
  return output
}

function splitSqlStatements(sql) {
  const statements = []
  let current = ''
  let state = ''
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]
    const next = sql[i + 1]
    if (state) {
      current += char
      if (state !== '`' && char === '\\' && next) {
        current += next
        i += 1
      } else if (char === state) {
        if (next === state) {
          current += next
          i += 1
        } else {
          state = ''
        }
      }
      continue
    }
    if (char === '`' || char === "'" || char === '"') {
      state = char
      current += char
    } else if (char === ';') {
      if (current.trim()) statements.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  requireThat(!state, 'SQL_QUOTE_UNTERMINATED')
  if (current.trim()) statements.push(current.trim())
  return statements
}

function splitTopLevel(text) {
  const parts = []
  let current = ''
  let state = ''
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (state) {
      current += char
      if (state !== '`' && char === '\\' && next) {
        current += next
        i += 1
      } else if (char === state) {
        if (next === state) {
          current += next
          i += 1
        } else {
          state = ''
        }
      }
      continue
    }
    if (char === '`' || char === "'" || char === '"') {
      state = char
      current += char
    } else if (char === '(') {
      depth += 1
      current += char
    } else if (char === ')') {
      depth -= 1
      requireThat(depth >= 0, 'SQL_PARENTHESIS_INVALID')
      current += char
    } else if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  requireThat(!state && depth === 0, 'SQL_PARENTHESIS_INVALID')
  if (current.trim()) parts.push(current.trim())
  return parts
}

function matchingParen(text, openingIndex) {
  let depth = 0
  let state = ''
  for (let i = openingIndex; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (state) {
      if (state !== '`' && char === '\\' && next) i += 1
      else if (char === state) {
        if (next === state) i += 1
        else state = ''
      }
      continue
    }
    if (char === '`' || char === "'" || char === '"') state = char
    else if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return i
      requireThat(depth > 0, 'SQL_PARENTHESIS_INVALID')
    }
  }
  throw new DiagnosticFailure('SQL_PARENTHESIS_INVALID')
}

function parseIdentifierList(value) {
  const body = value.trim().replace(/^\(/, '').replace(/\)$/, '')
  return splitTopLevel(body).map(part => {
    const match = part.trim().match(/^`([A-Za-z0-9_]+)`(?:\s*\(\s*\d+\s*\))?$/)
    requireThat(match, 'SQL_IDENTIFIER_UNSUPPORTED')
    return match[1]
  })
}

function canonicalType(value) {
  let normalized = String(value).toLowerCase().replace(/\s+/g, '')
  if (normalized === 'integer') normalized = 'int'
  if (normalized === 'boolean' || normalized === 'bool') normalized = 'tinyint(1)'
  return normalized
}

function canonicalDefault(value) {
  if (value === null || value === undefined) return null
  let normalized = String(value).trim()
  if (/^NULL$/i.test(normalized)) return null
  if (/^true$/i.test(normalized)) return '1'
  if (/^false$/i.test(normalized)) return '0'
  const timestamp = normalized.match(/^CURRENT_TIMESTAMP(?:\s*\(\s*(\d+)\s*\))?$/i)
  if (timestamp) return `current_timestamp${timestamp[1] === undefined ? '' : `(${timestamp[1]})`}`
  if (/^'(?:''|[^'])*'$/.test(normalized)) normalized = normalized.slice(1, -1).replace(/''/g, "'")
  return normalized
}

function expressionForCheck(value) {
  return String(value).replace(/`/g, '').replace(/\s+/g, '').replace(/^\(+|\)+$/g, '').toLowerCase()
}

function parseColumnDefinition(table, definition) {
  const match = definition.match(/^`([A-Za-z0-9_]+)`\s+((?:VARCHAR|CHAR|ENUM|SET)\s*\([^)]*\)|(?:DATETIME|TIMESTAMP|DECIMAL|FLOAT|DOUBLE|BIGINT|SMALLINT|TINYINT|INTEGER|INT|BOOLEAN|BOOL|TEXT|MEDIUMTEXT|LONGTEXT|JSON|DATE|TIME)(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)([\s\S]*)$/i)
  requireThat(match, 'SQL_COLUMN_DEFINITION_UNSUPPORTED')
  const [, name, type, tail] = match
  const notNull = /\bNOT\s+NULL\b/i.test(tail)
  const explicitNull = /(?:^|\s)NULL(?:\s|$)/i.test(tail) && !notNull
  const defaultMatch = tail.match(/\bDEFAULT\s+(CURRENT_TIMESTAMP(?:\s*\(\s*\d+\s*\))?|TRUE|FALSE|NULL|-?\d+(?:\.\d+)?|'(?:''|[^'])*')/i)
  const defaultSpecified = Boolean(defaultMatch)
  if (/\bDEFAULT\b/i.test(tail) && !defaultMatch) throw new DiagnosticFailure('SQL_COLUMN_DEFAULT_UNSUPPORTED')
  const remainder = defaultMatch ? `${tail.slice(0, defaultMatch.index)}${tail.slice(defaultMatch.index + defaultMatch[0].length)}` : tail
  const supportedTail = remainder.replace(/\bNOT\s+NULL\b|(?:^|\s)NULL(?=\s|$)|\bAUTO_INCREMENT\b/gi, '').trim()
  requireThat(!supportedTail || /^\bON\s+UPDATE\s+CURRENT_TIMESTAMP(?:\s*\(\s*\d+\s*\))?\b$/i.test(supportedTail), 'SQL_COLUMN_MODIFIER_UNSUPPORTED')
  return {
    table,
    name,
    type: canonicalType(type),
    nullable: notNull ? 'NO' : explicitNull ? 'YES' : 'YES',
    defaultSpecified,
    defaultValue: defaultSpecified ? canonicalDefault(defaultMatch[1]) : null,
  }
}

function parseIndex(table, definition) {
  const primary = definition.match(/^PRIMARY\s+KEY\s*(\([\s\S]*\))$/i)
  if (primary) return { table, name: 'PRIMARY', unique: true, kind: 'PRIMARY', columns: parseIdentifierList(primary[1]) }
  const named = definition.match(/^(UNIQUE\s+)?(?:INDEX|KEY)\s+`([A-Za-z0-9_]+)`\s*(\([\s\S]*\))$/i)
  if (named) return { table, name: named[2], unique: Boolean(named[1]), kind: named[1] ? 'UNIQUE' : 'INDEX', columns: parseIdentifierList(named[3]) }
  return null
}

function parseConstraint(table, definition) {
  const check = definition.match(/^CONSTRAINT\s+`([A-Za-z0-9_]+)`\s+CHECK\s*(\([\s\S]*\))$/i)
  if (check) return { type: 'check', value: { table, name: check[1], expression: expressionForCheck(check[2]) } }
  const fk = definition.match(/^CONSTRAINT\s+`([A-Za-z0-9_]+)`\s+FOREIGN\s+KEY\s*(\([\s\S]*?\))\s+REFERENCES\s+`([A-Za-z0-9_]+)`\s*(\([\s\S]*?\))([\s\S]*)$/i)
  if (fk) {
    const actions = fk[5]
    const deleteMatch = actions.match(/\bON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|NO\s+ACTION)\b/i)
    const updateMatch = actions.match(/\bON\s+UPDATE\s+(CASCADE|RESTRICT|SET\s+NULL|NO\s+ACTION)\b/i)
    const other = actions.replace(/\bON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|RESTRICT|SET\s+NULL|NO\s+ACTION)\b/gi, '').trim()
    requireThat(!other, 'SQL_FOREIGN_KEY_MODIFIER_UNSUPPORTED')
    return {
      type: 'foreignKey',
      value: {
        table,
        name: fk[1],
        columns: parseIdentifierList(fk[2]),
        referencedTable: fk[3],
        referencedColumns: parseIdentifierList(fk[4]),
        onDelete: (deleteMatch?.[1] || 'RESTRICT').replace(/\s+/g, ' ').toUpperCase(),
        onUpdate: (updateMatch?.[1] || 'RESTRICT').replace(/\s+/g, ' ').toUpperCase(),
      },
    }
  }
  return null
}

function addUnique(map, key, value, code) {
  requireThat(!map.has(key), code)
  map.set(key, value)
}

function objectKey(table, name) {
  return `${table}\u0000${name}`
}

export function parseMigrationSql(sql) {
  requireThat(typeof sql === 'string' && Buffer.byteLength(sql, 'utf8') <= MAX_SQL_BYTES, 'SQL_INPUT_INVALID')
  const result = { tables: [], columns: [], indexes: [], foreignKeys: [], checks: [] }
  const tables = new Set()
  const columns = new Map()
  const indexes = new Map()
  const foreignKeys = new Map()
  const checks = new Map()

  for (const statement of splitSqlStatements(stripComments(sql))) {
    const createTable = statement.match(/^CREATE\s+TABLE\s+`([A-Za-z0-9_]+)`\s*\(/i)
    if (createTable) {
      const table = createTable[1]
      const open = statement.indexOf('(', createTable[0].length - 1)
      const close = matchingParen(statement, open)
      requireThat(!statement.slice(close + 1).trim() || /^\s*DEFAULT\s+CHARACTER\s+SET\s+[A-Za-z0-9_]+\s+COLLATE\s+[A-Za-z0-9_]+\s*$/i.test(statement.slice(close + 1)), 'SQL_TABLE_SUFFIX_UNSUPPORTED')
      requireThat(!tables.has(table), 'SQL_TABLE_DUPLICATE')
      tables.add(table)
      for (const definition of splitTopLevel(statement.slice(open + 1, close))) {
        const index = parseIndex(table, definition)
        if (index) {
          addUnique(indexes, objectKey(table, index.name), index, 'SQL_INDEX_DUPLICATE')
          continue
        }
        const constraint = parseConstraint(table, definition)
        if (constraint?.type === 'foreignKey') {
          addUnique(foreignKeys, objectKey(table, constraint.value.name), constraint.value, 'SQL_FOREIGN_KEY_DUPLICATE')
          continue
        }
        if (constraint?.type === 'check') {
          addUnique(checks, objectKey(table, constraint.value.name), constraint.value, 'SQL_CHECK_DUPLICATE')
          continue
        }
        const column = parseColumnDefinition(table, definition)
        addUnique(columns, objectKey(table, column.name), column, 'SQL_COLUMN_DUPLICATE')
      }
      continue
    }

    const createIndex = statement.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+`([A-Za-z0-9_]+)`\s+ON\s+`([A-Za-z0-9_]+)`\s*(\([\s\S]*\))$/i)
    if (createIndex) {
      const index = { table: createIndex[3], name: createIndex[2], unique: Boolean(createIndex[1]), kind: createIndex[1] ? 'UNIQUE' : 'INDEX', columns: parseIdentifierList(createIndex[4]) }
      addUnique(indexes, objectKey(index.table, index.name), index, 'SQL_INDEX_DUPLICATE')
      continue
    }

    const alter = statement.match(/^ALTER\s+TABLE\s+`([A-Za-z0-9_]+)`\s+([\s\S]+)$/i)
    if (alter) {
      const table = alter[1]
      for (const action of splitTopLevel(alter[2])) {
        const addColumn = action.match(/^ADD\s+(?:COLUMN\s+)?([\s\S]+)$/i)
        if (addColumn && /^`/.test(addColumn[1])) {
          const column = parseColumnDefinition(table, addColumn[1])
          addUnique(columns, objectKey(table, column.name), column, 'SQL_COLUMN_DUPLICATE')
          continue
        }
        const constraint = parseConstraint(table, action.replace(/^ADD\s+/i, ''))
        if (constraint?.type === 'foreignKey') {
          addUnique(foreignKeys, objectKey(table, constraint.value.name), constraint.value, 'SQL_FOREIGN_KEY_DUPLICATE')
          continue
        }
        if (constraint?.type === 'check') {
          addUnique(checks, objectKey(table, constraint.value.name), constraint.value, 'SQL_CHECK_DUPLICATE')
          continue
        }
        throw new DiagnosticFailure('SQL_ALTER_ACTION_UNSUPPORTED')
      }
      continue
    }
    throw new DiagnosticFailure('SQL_STATEMENT_UNSUPPORTED')
  }

  result.tables = [...tables].sort()
  result.columns = [...columns.values()].sort((a, b) => objectKey(a.table, a.name).localeCompare(objectKey(b.table, b.name)))
  result.indexes = [...indexes.values()].sort((a, b) => objectKey(a.table, a.name).localeCompare(objectKey(b.table, b.name)))
  result.foreignKeys = [...foreignKeys.values()].sort((a, b) => objectKey(a.table, a.name).localeCompare(objectKey(b.table, b.name)))
  result.checks = [...checks.values()].sort((a, b) => objectKey(a.table, a.name).localeCompare(objectKey(b.table, b.name)))
  requireThat(Object.values(result).some(value => value.length > 0), 'SQL_NO_SCHEMA_OBJECTS')
  return result
}

export function compareMigrationManifests(left, right) {
  const stable = value => JSON.stringify(value)
  return stable(left) === stable(right)
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined) return null
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(text) ? text : 'UNSAFE_VALUE'
}

function safeLedgerValue(field, value) {
  if (value === undefined) return 'FIELD_VALUE_UNAVAILABLE'
  if (value === null) return null
  const text = String(value)
  if (field === 'id') return /^[A-Za-z0-9-]{1,128}$/.test(text) ? text : 'UNSAFE_VALUE'
  if (field === 'migration_name') return MIGRATIONS.includes(text) ? text : 'UNSAFE_VALUE'
  if (field === 'checksum') return /^[A-Fa-f0-9]{64}$/.test(text) ? text : 'INVALID_FORMAT'
  if (['started_at', 'finished_at', 'rolled_back_at'].includes(field)) return normalizeTimestamp(text)
  if (field === 'applied_steps_count') return /^(0|[1-9]\d*)$/.test(text) ? text : 'UNSAFE_VALUE'
  return 'UNSAFE_VALUE'
}

export function preserveLedgerRows(rows, presentColumns) {
  return rows.map(row => {
    const record = {}
    for (const [column, output] of LEDGER_FIELDS) {
      if (!presentColumns.has(column)) {
        record[output] = 'FIELD_NOT_PRESENT'
      } else if (column === 'logs') {
        record.logs = ['NULL', 'EMPTY', 'NONEMPTY'].includes(String(row.logs_status)) ? String(row.logs_status) : 'UNKNOWN'
      } else {
        record[output] = safeLedgerValue(column, row[output])
      }
    }
    return record
  })
}

function isChecksum(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

export function checksumsEqual(left, right) {
  return isChecksum(left) && isChecksum(right) && left.toLowerCase() === right.toLowerCase()
}

export function classifyMigration({ rows, availableFields, productionSha, rcSha, schemaMatch }) {
  if (!Array.isArray(rows) || !availableFields?.has('migration_name') || !availableFields?.has('started_at') || !availableFields?.has('finished_at') || !availableFields?.has('rolled_back_at')) return 'UNKNOWN'
  if (rows.length === 0) return 'UNKNOWN'
  const activeFailed = rows.some(row => row.finished_at === null && row.rolled_back_at === null)
  if (activeFailed) return 'ACTIVE_FAILED'
  const validTimestamps = rows.every(row => typeof row.started_at === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(row.started_at) &&
    ['finished_at', 'rolled_back_at'].every(field => row[field] === null || (typeof row[field] === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(row[field]))))
  if (!validTimestamps) return 'UNKNOWN'
  const successes = rows.filter(row => row.finished_at !== null && row.rolled_back_at === null)
  const rollbacks = rows.filter(row => row.finished_at === null && row.rolled_back_at !== null)
  if (successes.length + rollbacks.length !== rows.length) return 'UNKNOWN'
  const checksumAvailable = availableFields.has('checksum')
  const checksumMismatch = checksumAvailable && rows.some(row => !isChecksum(row.checksum) || !isChecksum(productionSha) || !isChecksum(rcSha) || row.checksum.toLowerCase() !== productionSha.toLowerCase() || row.checksum.toLowerCase() !== rcSha.toLowerCase()) ||
    (isChecksum(productionSha) && isChecksum(rcSha) && productionSha.toLowerCase() !== rcSha.toLowerCase())
  if (checksumMismatch) return 'CHECKSUM_MISMATCH'
  if (successes.length > 1) return 'DUPLICATE_SUCCESS'
  if (!checksumAvailable || !isChecksum(productionSha) || !isChecksum(rcSha)) return 'UNKNOWN'
  if (successes.length === 0 && rollbacks.length === rows.length) return 'ROLLED_BACK_ONLY'
  if (schemaMatch !== 'YES') return 'UNKNOWN'
  if (successes.length === 1 && rollbacks.length > 0 && successes.length + rollbacks.length === rows.length) return 'HISTORICAL_ROLLED_BACK_PLUS_SUCCESS'
  if (successes.length === 1 && rollbacks.length === 0 && rows.length === 1) return 'NORMAL_SUCCESS'
  return 'UNKNOWN'
}

function placeholders(values) {
  return values.map(() => '?').join(', ')
}

function normalizedActualType(value) {
  return canonicalType(value)
}

function normalizedActualDefault(value) {
  return canonicalDefault(value)
}

function sortValues(values) {
  return [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

function expectedEntries(manifest) {
  return [
    ...manifest.tables.map(name => ({ kind: 'TABLE', table: name, name })),
    ...manifest.columns.map(value => ({ kind: 'COLUMN', ...value })),
    ...manifest.indexes.map(({ kind: indexKind, ...value }) => ({ kind: 'INDEX', indexKind, ...value })),
    ...manifest.foreignKeys.map(value => ({ kind: 'FOREIGN_KEY', ...value })),
    ...manifest.checks.map(value => ({ kind: 'CHECK', ...value })),
  ]
}

function actualForExpected(expected, actual) {
  if (expected.kind === 'TABLE') return actual.tables.find(item => item.name === expected.name) ?? null
  if (expected.kind === 'COLUMN') return actual.columns.find(item => item.table === expected.table && item.name === expected.name) ?? null
  if (expected.kind === 'INDEX') return actual.indexes.find(item => item.table === expected.table && item.name === expected.name) ?? null
  if (expected.kind === 'FOREIGN_KEY') return actual.foreignKeys.find(item => item.table === expected.table && item.name === expected.name) ?? null
  if (expected.kind === 'CHECK') return actual.checks.find(item => item.table === expected.table && item.name === expected.name) ?? null
  return null
}

function matchesExpected(expected, found) {
  if (!found) return false
  if (expected.kind === 'TABLE') return found.type === 'BASE TABLE'
  if (expected.kind === 'COLUMN') {
    return normalizedActualType(found.columnType || found.dataType) === expected.type &&
      found.nullable === expected.nullable && normalizedActualDefault(found.defaultValue) === expected.defaultValue
  }
  if (expected.kind === 'INDEX') {
    return found.unique === expected.unique && JSON.stringify(found.columns) === JSON.stringify(expected.columns)
  }
  if (expected.kind === 'FOREIGN_KEY') {
    return JSON.stringify(found.columns) === JSON.stringify(expected.columns) &&
      found.referencedTable === expected.referencedTable &&
      JSON.stringify(found.referencedColumns) === JSON.stringify(expected.referencedColumns) &&
      canonicalRule(found.onDelete) === canonicalRule(expected.onDelete) && canonicalRule(found.onUpdate) === canonicalRule(expected.onUpdate)
  }
  if (expected.kind === 'CHECK') return expressionForCheck(found.expression) === expected.expression
  return false
}

function canonicalRule(value) {
  const rule = String(value).replace(/\s+/g, ' ').trim().toUpperCase()
  return rule === 'NO ACTION' ? 'RESTRICT' : rule
}

export function compareSchema(manifest, actual) {
  const expected = expectedEntries(manifest)
  const actualObjects = []
  const missing = []
  const unexpected = []
  for (const item of expected) {
    const found = actualForExpected(item, actual)
    if (!found) missing.push(item)
    else {
      actualObjects.push(found)
      if (!matchesExpected(item, found)) unexpected.push({ expected: item, actual: found })
    }
  }
  return {
    expected: sortValues(expected),
    actual: sortValues(actualObjects),
    missing: sortValues(missing),
    unexpected: sortValues(unexpected),
    match: missing.length === 0 && unexpected.length === 0 ? 'YES' : 'NO',
  }
}

export function safeErrorClass(error, phase) {
  if (error instanceof DiagnosticFailure) return error.code
  if (phase === 'database-connect') return 'DATABASE_CONNECTIVITY_FAILED'
  if (phase === 'ledger-query') return 'LEDGER_METADATA_READ_FAILED'
  if (phase === 'schema-query') return 'SCHEMA_METADATA_READ_FAILED'
  if (error?.code === 'ENOENT') return 'REQUIRED_FILE_MISSING'
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'READ_ACCESS_DENIED'
  return 'DIAGNOSTIC_OPERATION_FAILED'
}

function lstatRegular(file, code, maxBytes = MAX_SQL_BYTES) {
  const stat = fs.lstatSync(file)
  requireThat(stat.isFile() && !stat.isSymbolicLink(), code)
  requireThat(stat.size > 0 && stat.size <= maxBytes, `${code}_SIZE_INVALID`)
  return fs.readFileSync(file)
}

function safeCandidateRoot(root) {
  const resolved = path.resolve(root)
  const stat = fs.lstatSync(resolved)
  requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'CANDIDATE_PACKAGE_INVALID')
  return resolved
}

function validateMigrationFiles(root, layout, candidateSha = CANDIDATE_SHA) {
  requireThat(candidateSha === CANDIDATE_SHA, 'CANDIDATE_SHA_MISMATCH')
  const packageRoot = safeCandidateRoot(root)
  const candidateDir = path.join(packageRoot, layout === 'checkout' ? 'prisma' : 'candidate')
  const migrationRoot = path.join(candidateDir, 'migrations')
  for (const directory of [candidateDir, migrationRoot]) {
    const stat = fs.lstatSync(directory)
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'CANDIDATE_TREE_INVALID')
  }
  const manifests = new Map()
  const hashes = new Map()
  for (const name of MIGRATIONS) {
    const migrationDir = path.join(migrationRoot, name)
    const migrationStat = fs.lstatSync(migrationDir)
    requireThat(migrationStat.isDirectory() && !migrationStat.isSymbolicLink(), 'CANDIDATE_MIGRATION_DIR_INVALID')
    const file = path.join(migrationDir, 'migration.sql')
    const bytes = lstatRegular(file, 'CANDIDATE_SQL_INVALID')
    const sql = bytes.toString('utf8')
    requireThat(Buffer.from(sql, 'utf8').equals(bytes), 'CANDIDATE_SQL_ENCODING_INVALID')
    hashes.set(name, sha256(bytes))
    manifests.set(name, parseMigrationSql(sql))
  }
  return { packageRoot, hashes, manifests }
}

export function validateCandidateTree(root, candidateSha = CANDIDATE_SHA) {
  return validateMigrationFiles(root, 'checkout', candidateSha)
}

export function validateCandidatePackage(root, candidateSha = CANDIDATE_SHA) {
  return validateMigrationFiles(root, 'package', candidateSha)
}

function safeMigrationDirectory(release, name) {
  const prismaDir = path.join(release, 'prisma')
  const migrationsDir = path.join(prismaDir, 'migrations')
  for (const [file, code] of [[prismaDir, 'PRODUCTION_PRISMA_DIR_INVALID'], [migrationsDir, 'PRODUCTION_MIGRATIONS_DIR_INVALID']]) {
    const stat = fs.lstatSync(file)
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), code)
  }
  const dir = path.join(migrationsDir, name)
  const dirStat = fs.lstatSync(dir)
  requireThat(dirStat.isDirectory() && !dirStat.isSymbolicLink(), 'PRODUCTION_MIGRATION_DIR_INVALID')
  const file = path.join(dir, 'migration.sql')
  const bytes = lstatRegular(file, 'PRODUCTION_MIGRATION_SQL_INVALID')
  return { bytes, sql: bytes.toString('utf8'), sha256: sha256(bytes) }
}

function readReleaseEnvironment(release) {
  const releaseEnv = path.join(release, '.env')
  const sharedEnv = path.join(APP_ROOT, 'shared', '.env')
  const releaseEnvReal = fs.realpathSync(releaseEnv)
  const sharedEnvReal = fs.realpathSync(sharedEnv)
  requireThat(releaseEnvReal === sharedEnvReal, 'PRODUCTION_ENV_SOURCE_UNVERIFIED')
  const stat = fs.lstatSync(sharedEnvReal)
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 1024 * 1024, 'PRODUCTION_ENV_FILE_INVALID')
  const requireFromRelease = createRequire(path.join(release, 'package.json'))
  const dotenv = requireFromRelease('dotenv')
  const parsed = dotenv.parse(fs.readFileSync(sharedEnvReal, 'utf8'))
  requireThat(typeof parsed.DATABASE_URL === 'string' && parsed.DATABASE_URL.length > 0, 'DATABASE_URL_MISSING')
  let databaseUrl
  try { databaseUrl = new URL(parsed.DATABASE_URL) } catch { throw new DiagnosticFailure('DATABASE_URL_INVALID') }
  requireThat(databaseUrl.protocol === 'mysql:' && databaseUrl.hostname && databaseUrl.pathname.length > 1, 'DATABASE_URL_TARGET_INVALID')
  return parsed.DATABASE_URL
}

function selectList(present) {
  const selections = []
  for (const field of ['id', 'migration_name', 'checksum', 'started_at', 'finished_at', 'rolled_back_at', 'applied_steps_count']) {
    if (!present.has(field)) continue
    if (['started_at', 'finished_at', 'rolled_back_at'].includes(field)) selections.push(`CAST(\`${field}\` AS CHAR) AS \`${field}\``)
    else selections.push(`\`${field}\``)
  }
  if (present.has('logs')) selections.push("CASE WHEN `logs` IS NULL THEN 'NULL' WHEN CHAR_LENGTH(`logs`) = 0 THEN 'EMPTY' ELSE 'NONEMPTY' END AS `logs_status`")
  return selections
}

async function readLedger(db, emit) {
  const columns = await db.$queryRawUnsafe(
    'SELECT COLUMN_NAME AS columnName FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    '_prisma_migrations',
  )
  const present = new Set(columns.map(row => String(row.columnName)))
  emit('LEDGER_TABLE_PRESENT', columns.length ? 'YES' : 'NO')
  emit('LEDGER_TABLE_COLUMNS', JSON.stringify(LEDGER_FIELDS.map(([field]) => field).filter(field => present.has(field))))
  for (const field of ['id', 'migration_name', 'checksum', 'started_at', 'finished_at', 'rolled_back_at', 'applied_steps_count', 'logs']) {
    emit(`LEDGER_FIELD_${field.toUpperCase()}`, present.has(field) ? 'PRESENT' : 'FIELD_NOT_PRESENT')
  }
  const result = new Map()
  if (!present.has('migration_name')) {
    for (const name of MIGRATIONS) result.set(name, [])
    return { present, rows: result }
  }
  const selections = selectList(present)
  const order = ['started_at', 'id'].filter(field => present.has(field)).map(field => `\`${field}\``)
  for (const name of MIGRATIONS) {
    const query = `SELECT ${selections.join(', ')} FROM \`_prisma_migrations\` WHERE \`migration_name\` = ?${order.length ? ` ORDER BY ${order.join(', ')}` : ''}`
    const rows = await db.$queryRawUnsafe(query, name)
    result.set(name, rows)
  }
  return { present, rows: result }
}

async function readActualSchema(db, tableNames) {
  const actual = { tables: [], columns: [], indexes: [], foreignKeys: [], checks: [] }
  if (!tableNames.length) return actual
  const inTables = placeholders(tableNames)
  const tables = await db.$queryRawUnsafe(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${inTables})`,
    ...tableNames,
  )
  actual.tables = tables.map(row => ({ name: String(row.name), type: String(row.type).toUpperCase() }))

  const columns = await db.$queryRawUnsafe(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${inTables})`,
    ...tableNames,
  )
  actual.columns = columns.map(row => ({
    table: String(row.tableName), name: String(row.name), dataType: String(row.dataType),
    columnType: String(row.columnType), nullable: String(row.nullable).toUpperCase(),
    defaultValue: row.defaultValue === null ? null : String(row.defaultValue),
  }))

  const stats = await db.$queryRawUnsafe(
    `SELECT TABLE_NAME AS tableName, INDEX_NAME AS name, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${inTables}) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    ...tableNames,
  )
  const indexGroups = new Map()
  for (const row of stats) {
    const key = objectKey(String(row.tableName), String(row.name))
    const list = indexGroups.get(key) ?? []
    list.push(row)
    indexGroups.set(key, list)
  }
  actual.indexes = [...indexGroups].map(([key, rows]) => {
    const [table, name] = key.split('\u0000')
    rows.sort((a, b) => Number(a.sequence) - Number(b.sequence))
    return { table, name, unique: Number(rows[0]?.nonUnique) === 0, columns: rows.map(row => row.columnName === null ? null : String(row.columnName)) }
  })

  const fkRows = await db.$queryRawUnsafe(
    `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, COLUMN_NAME AS columnName, ORDINAL_POSITION AS sequence, REFERENCED_TABLE_NAME AS referencedTable, REFERENCED_COLUMN_NAME AS referencedColumn FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${inTables}) AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    ...tableNames,
  )
  const rules = await db.$queryRawUnsafe(
    `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, DELETE_RULE AS onDelete, UPDATE_RULE AS onUpdate FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN (${inTables})`,
    ...tableNames,
  )
  const ruleMap = new Map(rules.map(row => [objectKey(String(row.tableName), String(row.name)), row]))
  const fkGroups = new Map()
  for (const row of fkRows) {
    const key = objectKey(String(row.tableName), String(row.name))
    const list = fkGroups.get(key) ?? []
    list.push(row)
    fkGroups.set(key, list)
  }
  actual.foreignKeys = [...fkGroups].map(([key, rows]) => {
    const [table, name] = key.split('\u0000')
    rows.sort((a, b) => Number(a.sequence) - Number(b.sequence))
    const rule = ruleMap.get(key)
    return {
      table, name,
      columns: rows.map(row => String(row.columnName)),
      referencedTable: String(rows[0]?.referencedTable ?? ''),
      referencedColumns: rows.map(row => String(row.referencedColumn ?? '')),
      onDelete: String(rule?.onDelete ?? 'UNKNOWN').toUpperCase(),
      onUpdate: String(rule?.onUpdate ?? 'UNKNOWN').toUpperCase(),
    }
  })

  const checks = await db.$queryRawUnsafe(
    `SELECT tc.TABLE_NAME AS tableName, tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS expression FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME IN (${inTables}) AND tc.CONSTRAINT_TYPE = 'CHECK'`,
    ...tableNames,
  )
  actual.checks = checks.map(row => ({ table: String(row.tableName), name: String(row.name), expression: String(row.expression) }))
  return actual
}

function preparedRows(rows, present) {
  return preserveLedgerRows(rows, present)
}

function successSummary(rows, present) {
  if (!present.has('finished_at') || !present.has('rolled_back_at')) return { activeFailed: 'UNKNOWN', successCount: 'UNKNOWN', rollbackCount: 'UNKNOWN', rollbackOnly: 'UNKNOWN' }
  const activeFailed = rows.filter(row => row.finished_at === null && row.rolled_back_at === null).length
  const successes = rows.filter(row => row.finished_at !== null && row.rolled_back_at === null).length
  const rollbacks = rows.filter(row => row.rolled_back_at !== null).length
  return {
    activeFailed: activeFailed ? 'YES' : 'NO', successCount: successes, rollbackCount: rollbacks,
    rollbackOnly: rows.length > 0 && successes === 0 && rollbacks === rows.length ? 'YES' : 'NO',
  }
}

function outputMigration(name, prod, rc, rows, present, schema, emit) {
  const safeRows = preparedRows(rows, present)
  const summary = successSummary(rows, present)
  emit('MIGRATION_NAME', name)
  emit('LEDGER_ROW_COUNT', rows.length)
  emit('LEDGER_RECORDS', JSON.stringify(safeRows))
  emit('ACTIVE_FAILED_ROW', summary.activeFailed)
  emit('SUCCESS_ROW_COUNT', summary.successCount)
  emit('ROLLBACK_ROW_COUNT', summary.rollbackCount)
  emit('ROLLED_BACK_ONLY', summary.rollbackOnly)

  const prodSha = prod?.sha256 ?? 'UNKNOWN'
  const rcSha = rc?.sha256 ?? 'UNKNOWN'
  emit('PRODUCTION_SHA256', prodSha)
  emit('RC_SHA256', rcSha)
  const ledgerChecksums = safeRows.map(row => row.checksum)
  emit('LEDGER_CHECKSUMS', JSON.stringify(ledgerChecksums))
  emit('PRODUCTION_EQ_RC', isChecksum(prodSha) && isChecksum(rcSha) ? (checksumsEqual(prodSha, rcSha) ? 'YES' : 'NO') : 'UNKNOWN')
  emit('PRODUCTION_EQ_LEDGER', safeRows.length && safeRows.every(row => isChecksum(prodSha) && isChecksum(row.checksum) && row.checksum.toLowerCase() === prodSha.toLowerCase()) ? 'YES' : safeRows.length ? 'NO' : 'UNKNOWN')
  emit('RC_EQ_LEDGER', safeRows.length && safeRows.every(row => isChecksum(rcSha) && isChecksum(row.checksum) && row.checksum.toLowerCase() === rcSha.toLowerCase()) ? 'YES' : safeRows.length ? 'NO' : 'UNKNOWN')
  if (schema) {
    emit('EXPECTED_SCHEMA_OBJECTS', JSON.stringify(schema.expected))
    emit('ACTUAL_SCHEMA_OBJECTS', JSON.stringify(schema.actual))
    emit('MISSING_SCHEMA_OBJECTS', JSON.stringify(schema.missing))
    emit('UNEXPECTED_SCHEMA_OBJECTS', JSON.stringify(schema.unexpected))
    emit('SCHEMA_MATCH', schema.match)
  } else {
    emit('EXPECTED_SCHEMA_OBJECTS', 'UNKNOWN')
    emit('ACTUAL_SCHEMA_OBJECTS', 'UNKNOWN')
    emit('MISSING_SCHEMA_OBJECTS', 'UNKNOWN')
    emit('UNEXPECTED_SCHEMA_OBJECTS', 'UNKNOWN')
    emit('SCHEMA_MATCH', 'UNKNOWN')
  }
  emit('CLASSIFICATION', classifyMigration({ rows, availableFields: present, productionSha: prodSha, rcSha, schemaMatch: schema?.match ?? 'UNKNOWN' }))
  emit('MIGRATION_END', name)
}

async function collect({ packageRoot, appRoot, expectedProductionSha, candidateSha }) {
  const emit = (key, value) => console.log(`${key}=${value}`)
  requireThat(path.resolve(appRoot) === APP_ROOT, 'APP_ROOT_INVALID')
  requireThat(expectedProductionSha === EXPECTED_PRODUCTION_SHA, 'EXPECTED_PRODUCTION_SHA_INVALID')
  requireThat(candidateSha === CANDIDATE_SHA, 'CANDIDATE_SHA_MISMATCH')
  const validatedPackage = validateCandidatePackage(packageRoot, candidateSha)

  const currentLink = path.join(appRoot, 'current')
  const release = fs.realpathSync(currentLink)
  requireThat(release.startsWith(`${path.join(appRoot, 'releases')}${path.sep}`), 'PRODUCTION_RELEASE_PATH_INVALID')
  const shaFile = path.join(release, '.deployed-sha')
  const shaBytes = lstatRegular(shaFile, 'PRODUCTION_RELEASE_SHA_INVALID', 256)
  const productionSha = shaBytes.toString('utf8').trim()
  requireThat(/^[0-9a-f]{40}$/.test(productionSha) && productionSha === expectedProductionSha, 'PRODUCTION_RELEASE_SHA_MISMATCH')
  const databaseUrl = readReleaseEnvironment(release)
  process.env.DATABASE_URL = databaseUrl
  const requireFromRelease = createRequire(path.join(release, 'package.json'))
  let PrismaClient
  try { ({ PrismaClient } = requireFromRelease('@prisma/client')) } catch { throw new DiagnosticFailure('PRISMA_CLIENT_UNAVAILABLE') }

  const productionFiles = new Map()
  const productionManifests = new Map()
  for (const name of MIGRATIONS) {
    const file = safeMigrationDirectory(release, name)
    productionFiles.set(name, file)
    productionManifests.set(name, parseMigrationSql(file.sql))
  }

  const db = new PrismaClient({ log: [] })
  let phase = 'database-connect'
  try {
    await db.$connect()
    emit('DATABASE_CONNECTIVITY', 'PASS')
    phase = 'ledger-query'
    const ledger = await readLedger(db, emit)
    phase = 'schema-query'
    const tableNames = [...new Set([...productionManifests.values(), ...validatedPackage.manifests.values()].flatMap(manifest => [
      ...manifest.tables,
      ...manifest.columns.map(item => item.table),
      ...manifest.indexes.map(item => item.table),
      ...manifest.foreignKeys.map(item => item.table),
      ...manifest.checks.map(item => item.table),
    ]))].sort()
    const actual = await readActualSchema(db, tableNames)
    emit('SCHEMA_METADATA_READ', 'PASS')
    emit('PRODUCTION_RELEASE_SHA', productionSha)
    emit('CANDIDATE_SHA', candidateSha)
    emit('DATABASE_ENV_SOURCE', 'verified_current_release_dotenv')

    for (const name of MIGRATIONS) {
      const production = productionFiles.get(name)
      const rcSha = validatedPackage.hashes.get(name)
      const productionManifest = productionManifests.get(name)
      const rcManifest = validatedPackage.manifests.get(name)
      const schema = compareSchema(productionManifest, actual)
      const sameExpectedObjects = compareMigrationManifests(productionManifest, rcManifest)
      const schemaResult = sameExpectedObjects ? schema : { ...schema, match: 'UNKNOWN' }
      outputMigration(name, production, { sha256: rcSha }, ledger.rows.get(name) ?? [], ledger.present, schemaResult, emit)
      emit('PRODUCTION_EQ_RC_SCHEMA_OBJECTS', sameExpectedObjects ? 'YES' : 'NO')
    }
    emit('DIAGNOSTIC_STATUS', 'COMPLETE')
    return 0
  } catch (error) {
    emit(phase === 'database-connect' ? 'DATABASE_CONNECTIVITY' : phase === 'ledger-query' ? 'LEDGER_READ' : 'SCHEMA_METADATA_READ', 'FAIL')
    emit('DIAGNOSTIC_ERROR_CLASS', safeErrorClass(error, phase))
    for (const name of MIGRATIONS) emit('CLASSIFICATION', 'UNKNOWN')
    emit('DIAGNOSTIC_STATUS', 'PARTIAL')
    return 1
  } finally {
    await db.$disconnect().catch(() => {})
  }
}

function cliError(error) {
  return error instanceof DiagnosticFailure ? error.code : 'DIAGNOSTIC_OPERATION_FAILED'
}

async function main() {
  const mode = process.argv[2]
  if (mode === 'validate-host') {
    validateHostIdentity({
      host: process.env.SSH_HOST,
      user: process.env.SSH_USER,
      port: process.env.SSH_PORT,
      sshKey: process.env.SSH_KEY,
      pinnedHosts: process.env.PINNED_HOSTS,
      pinnedFingerprint: process.env.PINNED_FINGERPRINT,
    })
    console.log('SSH_HOST_IDENTITY=PINNED_AND_VERIFIED')
    return 0
  }
  if (mode === 'validate-candidate') {
    const candidate = validateCandidateTree(process.argv[3], process.argv[4])
    console.log(`CANDIDATE_SHA=${CANDIDATE_SHA}`)
    console.log(`CANDIDATE_MIGRATION_SQL_COUNT=${MIGRATIONS.length}`)
    for (const name of MIGRATIONS) console.log(`CANDIDATE_MIGRATION_SHA256 ${name}=${candidate.hashes.get(name)}`)
    return 0
  }
  if (mode === 'collect') {
    return await collect({
      packageRoot: process.argv[3],
      appRoot: process.argv[4],
      expectedProductionSha: process.argv[5],
      candidateSha: process.argv[6],
    })
  }
  throw new DiagnosticFailure('MODE_INVALID')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code }).catch(error => {
    console.log(`DIAGNOSTIC_STATUS=FAIL`)
    console.log(`DIAGNOSTIC_ERROR_CLASS=${cliError(error)}`)
    process.exitCode = 1
  })
}
