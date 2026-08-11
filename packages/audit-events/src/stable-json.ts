import { createHash } from "node:crypto";

import { InvalidAuditInputError } from "./errors.ts";
import type { JsonValue } from "./types.ts";

function canonicalize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new InvalidAuditInputError(`${path} must contain a finite number.`);
      }
      return JSON.stringify(value);
    case "object": {
      const object = value as object;
      if (seen.has(object)) {
        throw new InvalidAuditInputError(`${path} must not contain circular references.`);
      }
      seen.add(object);

      let result: string;
      if (Array.isArray(value)) {
        result = `[${value
          .map((item, index) => canonicalize(item, `${path}[${index}]`, seen))
          .join(",")}]`;
      } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new InvalidAuditInputError(`${path} must contain only JSON objects.`);
        }

        const record = value as Record<string, unknown>;
        result = `{${Object.keys(record)
          .sort()
          .map((key) => {
            if (record[key] === undefined) {
              throw new InvalidAuditInputError(`${path}.${key} must not be undefined.`);
            }
            return `${JSON.stringify(key)}:${canonicalize(record[key], `${path}.${key}`, seen)}`;
          })
          .join(",")}}`;
      }

      seen.delete(object);
      return result;
    }
    default:
      throw new InvalidAuditInputError(`${path} must be valid JSON.`);
  }
}

export function stableStringify(value: JsonValue): string {
  return canonicalize(value, "value", new Set());
}

export function commandFingerprint(commandType: string, payload: JsonValue): string {
  return createHash("sha256")
    .update(commandType)
    .update("\0")
    .update(stableStringify(payload))
    .digest("hex");
}

export function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  try {
    canonicalize(value, label, new Set());
  } catch (error) {
    if (error instanceof InvalidAuditInputError) throw error;
    throw new InvalidAuditInputError(`${label} must be valid JSON.`);
  }
}
