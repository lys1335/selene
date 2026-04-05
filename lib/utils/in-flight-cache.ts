/**
 * Deduplicates concurrent async calls with the same key.
 * If a request for `key` is already in-flight, returns the same promise.
 * The cache entry is deleted when the promise resolves or rejects.
 */
const caches = new Map<string, Map<string, Promise<unknown>>>();

export function deduplicate<T>(
  namespace: string,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!caches.has(namespace)) caches.set(namespace, new Map());
  const ns = caches.get(namespace)!;
  if (ns.has(key)) return ns.get(key) as Promise<T>;
  const p = fn().finally(() => ns.delete(key));
  ns.set(key, p);
  return p;
}
