import { transformCommonRecord } from "./common";
import { transformUser } from "./user";

export type RecordTransformer = (
  record: Record<string, unknown>,
) => Record<string, unknown>;

const modelTransformers: Record<string, RecordTransformer> = {
  User: transformUser,
};

export function transformRecord(
  model: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  return (modelTransformers[model] ?? transformCommonRecord)(record);
}

export { transformCommonRecord, transformUser };
