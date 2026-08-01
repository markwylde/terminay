import type { JsonValue } from "./errors.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export function encodeCanonicalJson(value: unknown): Uint8Array {
  assertJsonValue(value);
  return textEncoder.encode(canonicalize(value));
}

export function decodeCanonicalJson(bytes: Uint8Array): JsonValue {
  let text: string;
  try { text = textDecoder.decode(bytes); } catch { throw new TypeError("invalid UTF-8"); }
  const parser = new StrictJsonParser(text);
  const value = parser.parse();
  const canonical = canonicalize(value);
  if (canonical !== text) throw new TypeError("JSON is not canonical");
  return value;
}

export function canonicalize(value: unknown): string {
  assertJsonValue(value);
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function assertJsonValue(value: unknown, depth = 0): asserts value is JsonValue {
  if (depth > 32) throw new RangeError("JSON nesting limit");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON number must be finite");
    return;
  }
  if (Array.isArray(value)) { for (const item of value) assertJsonValue(item, depth + 1); return; }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new TypeError(`undefined JSON field ${key}`);
      assertJsonValue(item, depth + 1);
    }
    return;
  }
  throw new TypeError("value is not JSON");
}

class StrictJsonParser {
  private offset = 0;
  constructor(private readonly text: string) {}
  parse(): JsonValue {
    const result = this.parseValue();
    if (this.offset !== this.text.length) throw new TypeError("trailing JSON data");
    return result;
  }
  private parseValue(): JsonValue {
    const c = this.text[this.offset];
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === '"') return this.parseString();
    if (c === "t" && this.take("true")) return true;
    if (c === "f" && this.take("false")) return false;
    if (c === "n" && this.take("null")) return null;
    if (c === "-" || (c >= "0" && c <= "9")) return this.parseNumber();
    throw new TypeError(`invalid JSON at ${this.offset}`);
  }
  private parseObject(): { [key: string]: JsonValue } {
    this.offset++; const result: { [key: string]: JsonValue } = {}; const seen = new Set<string>();
    this.ws(); if (this.text[this.offset] === "}") { this.offset++; return result; }
    while (true) {
      if (this.text[this.offset] !== '"') throw new TypeError("object key must be a string");
      const key = this.parseString();
      if (seen.has(key)) throw new TypeError(`duplicate key ${key}`); seen.add(key);
      this.ws(); if (this.text[this.offset++] !== ":") throw new TypeError("missing colon");
      this.ws(); result[key] = this.parseValue(); this.ws();
      if (this.text[this.offset] === "}") { this.offset++; return result; }
      if (this.text[this.offset++] !== ",") throw new TypeError("missing comma"); this.ws();
    }
  }
  private parseArray(): JsonValue[] {
    this.offset++; const result: JsonValue[] = []; this.ws();
    if (this.text[this.offset] === "]") { this.offset++; return result; }
    while (true) {
      this.ws(); result.push(this.parseValue()); this.ws();
      if (this.text[this.offset] === "]") { this.offset++; return result; }
      if (this.text[this.offset++] !== ",") throw new TypeError("missing comma");
    }
  }
  private parseString(): string {
    const start = this.offset++; let escaped = false;
    while (this.offset < this.text.length) {
      const code = this.text.charCodeAt(this.offset++);
      if (code === 34 && !escaped) {
        const raw = this.text.slice(start, this.offset);
        try { const value = JSON.parse(raw); if (typeof value !== "string") throw new Error(); return value; } catch { throw new TypeError("invalid string"); }
      }
      if (code < 0x20) throw new TypeError("control character in string");
      if (escaped) escaped = false; else if (code === 92) escaped = true;
    }
    throw new TypeError("unterminated string");
  }
  private parseNumber(): number {
    const match = this.text.slice(this.offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new TypeError("invalid number"); this.offset += match[0].length;
    const value = Number(match[0]); if (!Number.isFinite(value)) throw new TypeError("non-finite number"); return value;
  }
  private ws(): void { while (/\s/.test(this.text[this.offset] ?? "")) this.offset++; }
  private take(value: string): boolean { if (this.text.startsWith(value, this.offset)) { this.offset += value.length; return true; } return false; }
}
