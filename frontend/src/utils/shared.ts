export interface LocalStorageAdapter {
  getItem<T>(key: string): T | null;
  setItem<T>(key: string, value: T): void;
  removeItem(key: string): void;
}

const memoryStorage = new Map<string, string>();

export function storageLocal(): LocalStorageAdapter {
  return {
    getItem<T>(key: string): T | null {
      let raw: string | null;
      try {
        raw = globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        raw = memoryStorage.get(key) ?? null;
      }
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as T;
      }
    },
    setItem<T>(key: string, value: T) {
      const raw = JSON.stringify(value);
      if (raw === undefined) {
        this.removeItem(key);
        return;
      }
      try {
        if (globalThis.localStorage) {
          globalThis.localStorage.setItem(key, raw);
          return;
        }
      } catch {
        // Use the in-memory fallback when browser storage is unavailable.
      }
      memoryStorage.set(key, raw);
    },
    removeItem(key: string) {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // Clear the fallback too when browser storage is unavailable.
      }
      memoryStorage.delete(key);
    }
  };
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAllEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isObject(value) && Object.keys(value).length === 0;
}

export function isIncludeAllChildren(
  values: string[],
  permissions: string[]
): boolean {
  return values.every(value => permissions.includes(value));
}

export function intersection<T>(left: T[], right: T[]): T[] {
  const rightSet = new Set(right);
  return left.filter(value => rightSet.has(value));
}

export function getKeyList<T extends Record<string, unknown>>(
  values: T[],
  key: string
): unknown[] {
  const keys = key.split(".");
  return values.map(value => keys.reduce<unknown>(
    (current, part) => current && typeof current === "object"
      ? (current as Record<string, unknown>)[part]
      : undefined,
    value
  ));
}

export function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function openLink(url: string): void {
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}

export function deviceDetection(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

export function isEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => isEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every(key => Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      isEqual(leftRecord[key], rightRecord[key]));
}

export function cloneDeep<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const source = value as object;
  const existing = seen.get(source);
  if (existing) return existing as T;
  if (source instanceof Date) return new Date(source.getTime()) as T;
  if (source instanceof RegExp) return new RegExp(source.source, source.flags) as T;
  if (Array.isArray(source)) {
    const result: unknown[] = [];
    seen.set(source, result);
    for (const item of source) result.push(cloneDeep(item, seen));
    return result as T;
  }
  const prototype = Object.getPrototypeOf(source);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const result = Object.create(prototype) as Record<PropertyKey, unknown>;
  seen.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    result[key] = cloneDeep((source as Record<PropertyKey, unknown>)[key], seen);
  }
  return result as T;
}

export function debounce<T extends (...args: never[]) => unknown>(
  callback: T,
  delay = 200,
  immediate = false
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return function debounced(this: unknown, ...args: Parameters<T>) {
    const callNow = immediate && !timer;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!immediate) callback.apply(this, args);
    }, delay);
    if (callNow) callback.apply(this, args);
  };
}

export function throttle<T extends (...args: never[]) => unknown>(
  callback: T,
  delay = 1000
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latestArgs: Parameters<T>;
  let latestThis: unknown;
  return function throttled(this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    latestArgs = args;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Debounced calls retain the caller context.
    latestThis = this;
    if (now - lastCall >= delay) {
      lastCall = now;
      callback.apply(latestThis, latestArgs);
      return;
    }
    if (!timer) {
      timer = setTimeout(() => {
        timer = undefined;
        lastCall = Date.now();
        callback.apply(latestThis, latestArgs);
      }, delay - (now - lastCall));
    }
  };
}

export function subBefore(value: string, separator: string): string {
  const index = value.indexOf(separator);
  return index < 0 ? value : value.slice(0, index);
}

export function subAfter(value: string, separator: string): string {
  const index = value.indexOf(separator);
  return index < 0 ? "" : value.slice(index + separator.length);
}

export function hasClass(element: Element | undefined, className: string): boolean {
  return Boolean(element?.classList.contains(className));
}

export function toggleClass(enabled: boolean, className: string, element: Element | undefined): void {
  element?.classList.toggle(className, enabled);
}

export async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Try the legacy document copy command below.
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  return copied;
}

export function svgRawToIcon(rawSvg: string): {
  body: string;
  width: number;
  height: number;
  left: number;
  top: number;
} {
  const match = rawSvg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  if (!match) throw new Error("Invalid inline SVG icon");
  const attributes = match[1];
  const attribute = (name: string) => attributes.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
  const viewBox = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = viewBox?.[2] || Number.parseFloat(attribute("width") ?? "24") || 24;
  const height = viewBox?.[3] || Number.parseFloat(attribute("height") ?? "24") || 24;
  return {
    body: match[2].trim(),
    left: viewBox?.[0] ?? 0,
    top: viewBox?.[1] ?? 0,
    width,
    height
  };
}
