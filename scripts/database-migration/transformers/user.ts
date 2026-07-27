import { transformCommonRecord } from "./common";

export function transformUser(
  record: Record<string, unknown>,
): Record<string, unknown> {
  // Kept as a dedicated hook for future user-specific compatibility fixes.
  // IDs, nullable values, enums and UTC dates use the common lossless transform.
  return transformCommonRecord(record);
}
