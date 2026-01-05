/**
 * Singleton Factory Utility
 *
 * Creates singleton instances with optional globalThis persistence
 * for Next.js hot reload compatibility.
 */

/**
 * Create a simple singleton getter
 *
 * @example
 * const getMyService = createSingleton(() => new MyService());
 * const instance = getMyService(); // Always returns same instance
 */
export function createSingleton<T>(factory: () => T): () => T {
  let instance: T | null = null;

  return (): T => {
    if (!instance) {
      instance = factory();
    }
    return instance;
  };
}

/**
 * Create a singleton that persists across Next.js hot reloads
 *
 * Uses globalThis to maintain instance during development hot reloads.
 * In production, behaves like a normal singleton.
 *
 * @param key - Unique key for globalThis storage
 * @param factory - Factory function to create the instance
 *
 * @example
 * const getBotManager = createGlobalSingleton('botManager', () => new BotManager());
 */
export function createGlobalSingleton<T>(
  key: string,
  factory: () => T
): () => T {
  const globalStore = globalThis as unknown as Record<string, T | undefined>;

  return (): T => {
    if (!globalStore[key]) {
      globalStore[key] = factory();
    }
    return globalStore[key] as T;
  };
}

/**
 * Reset a global singleton (useful for testing)
 *
 * @param key - The key used when creating the singleton
 * @param cleanup - Optional cleanup function to call before resetting
 */
export function resetGlobalSingleton(
  key: string,
  cleanup?: (instance: unknown) => void
): void {
  const globalStore = globalThis as unknown as Record<string, unknown>;

  if (globalStore[key] && cleanup) {
    cleanup(globalStore[key]);
  }

  delete globalStore[key];
}
