/**
 * Helper validate variables theo `variables_schema_json` của template version.
 *
 * Đây là phiên bản đơn giản của JSON Schema subset — đủ cho v1: kiểm `type`,
 * `required`, `properties`. Không dùng thư viện bên ngoài (quy tắc: không add
 * dependency cho vài dòng). Nếu schema hỏng → trả `{ ok: false, reason: 'broken' }`.
 *
 * Không tự ép kiểu: `1` khác `"1"` (§6.2).
 */

interface SimpleJsonSchema {
  readonly type: string;
  readonly properties?: Record<string, SimpleJsonSchema>;
  readonly items?: SimpleJsonSchema;
  readonly required?: readonly string[];
}

/** Kết quả parse + validate. */
export type TemplateSchemaValidation =
  | {
      readonly ok: true;
      readonly schema: SimpleJsonSchema;
      readonly normalized: Record<string, unknown>;
    }
  | {
      readonly ok: false;
      readonly reason: 'broken' | 'invalid_variables' | 'allowlist_unconfigured';
    };

/**
 * Parse `variables_schema_json` thành subset schema đơn giản.
 * Nếu JSON không parse được hoặc thiếu `type` → broken.
 */
export function parseTemplateSchema(variablesSchemaJson: string): TemplateSchemaValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(variablesSchemaJson);
  } catch {
    return { ok: false, reason: 'broken' };
  }
  const schema = normalizeSchema(parsed);
  if (schema === null) {
    return { ok: false, reason: 'broken' };
  }
  return { ok: true, schema, normalized: {} };
}

/** Chuẩn hoá schema object thành subset — các field lạ bị bỏ qua. */
function normalizeSchema(value: unknown): SimpleJsonSchema | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== 'string') {
    return null;
  }
  const required = Array.isArray(obj.required)
    ? obj.required.filter((v): v is string => typeof v === 'string')
    : undefined;
  let properties: Record<string, SimpleJsonSchema> | undefined;
  if (type === 'object' && typeof obj.properties === 'object' && obj.properties !== null) {
    properties = {};
    for (const [k, v] of Object.entries(obj.properties as Record<string, unknown>)) {
      const child = normalizeSchema(v);
      if (child !== null) {
        properties[k] = child;
      }
    }
  }
  let items: SimpleJsonSchema | undefined;
  if (type === 'array' && typeof obj.items !== 'undefined') {
    items = normalizeSchema(obj.items) ?? undefined;
  }
  return {
    items,
    properties,
    required,
    type: type as SimpleJsonSchema['type'],
  };
}

/**
 * Validate `variables` theo schema. Không tự ép kiểu.
 * `allowlistUnconfigured` = true khi biến `format: 'url'` không có allowlist (được truyền
 * qua `urlAllowlist` ở usecase; ở đây chỉ ghim shape).
 */
export function validateVariablesAgainstSchema(
  schema: SimpleJsonSchema,
  variables: Record<string, unknown>,
): TemplateSchemaValidation {
  const normalized: Record<string, unknown> = {};
  const errors = validateValue(schema, variables, normalized);
  if (errors.length > 0) {
    return { ok: false, reason: 'invalid_variables' };
  }
  return { ok: true, schema, normalized };
}

function validateValue(
  schema: SimpleJsonSchema,
  value: unknown,
  normalized: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') errors.push('type mismatch');
      else normalized[schema.type] = value;
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) errors.push('type mismatch');
      else normalized[schema.type] = value;
      break;
    case 'integer':
      if (!Number.isInteger(value)) errors.push('type mismatch');
      else normalized[schema.type] = value;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push('type mismatch');
      else normalized[schema.type] = value;
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push('type mismatch');
        break;
      }
      if (schema.required) {
        for (const req of schema.required) {
          if (!(req in value)) errors.push(`missing ${req}`);
        }
      }
      if (schema.properties) {
        for (const [k, child] of Object.entries(schema.properties)) {
          if (k in value) {
            const childErrors = validateValue(
              child,
              (value as Record<string, unknown>)[k],
              normalized,
            );
            errors.push(...childErrors);
          }
        }
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        errors.push('type mismatch');
        break;
      }
      if (schema.items) {
        for (const item of value) {
          errors.push(...validateValue(schema.items, item, normalized));
        }
      }
      break;
  }
  return errors;
}
