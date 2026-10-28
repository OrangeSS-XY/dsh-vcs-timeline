/**
 * dsh-vcs-timeline — defensive accessors for provider JSON.
 *
 * Provider payloads are untrusted data: every read goes through these
 * accessors so a missing, mistyped or hostile field yields `undefined` instead
 * of throwing, and mapping code never spreads an unknown value into a
 * contract object.
 * @module dsh-vcs-timeline/host/pr/json
 */

/** Narrow a value to a plain object. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Narrow a value to an array (empty when it is not one). */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Read a non-empty string. */
export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Read a finite number. */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read a boolean. */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Read an ISO 8601 timestamp, falling back when the provider sent none. */
export function asIso(value: unknown, fallback: string): string {
  const raw = asString(value)
  if (raw === undefined) return fallback
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

/** Read an optional ISO 8601 timestamp in canonical form. */
export function asOptionalIso(value: unknown): string | undefined {
  const raw = asString(value)
  if (raw === undefined) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Read one object field. */
export function pickRecord(
  value: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  return asRecord(value[key])
}

/** Read one string field. */
export function pickString(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (value === null || value === undefined) return undefined
  return asString(value[key])
}

/** Read one number field. */
export function pickNumber(
  value: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  if (value === null || value === undefined) return undefined
  return asNumber(value[key])
}

/** Read one boolean field. */
export function pickBoolean(
  value: Record<string, unknown> | null | undefined,
  key: string,
): boolean | undefined {
  if (value === null || value === undefined) return undefined
  return asBoolean(value[key])
}

/** Read one array field, keeping element values untyped for later mapping. */
export function pickArray(
  value: Record<string, unknown> | null | undefined,
  key: string,
): unknown[] {
  if (value === null || value === undefined) return []
  return asArray(value[key])
}

/** Read one ISO timestamp field. */
export function pickIso(
  value: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
): string {
  if (value === null || value === undefined) return fallback
  return asIso(value[key], fallback)
}
