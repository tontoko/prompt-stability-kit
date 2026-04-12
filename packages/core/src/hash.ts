import { createHash } from "node:crypto";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function stableHash(value: string): string {
  return digest(value);
}

export function semanticHash(value: string): string {
  return digest(value.replace(/\s+/gu, " ").trim().toLowerCase());
}
