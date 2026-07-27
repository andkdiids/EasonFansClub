type RecordValue = unknown;

/**
 * Prisma already exposes UUIDs and enums as strings. Dates are recreated from
 * their ISO representation so their UTC instant is preserved across clients.
 * JSON values are copied recursively and null is intentionally left unchanged.
 */
export function transformCommonRecord(
  record: Record<string, RecordValue>,
): Record<string, RecordValue> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, transformValue(value)]),
  );
}

export function transformValue(value: RecordValue): RecordValue {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.toISOString());
  }
  if (Array.isArray(value)) {
    return value.map(transformValue);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "object") {
    const decimalLike = value as { constructor?: { name?: string }; toString?: () => string };
    if (
      decimalLike.constructor?.name === "Decimal" &&
      typeof decimalLike.toString === "function"
    ) {
      return decimalLike.toString();
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        transformValue(item),
      ]),
    );
  }
  return value;
}
