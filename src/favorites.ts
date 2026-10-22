const STORAGE_KEY = 'streetgame.favorites';

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string' || !item || seen.has(item)) continue;
      seen.add(item);
      ids.push(item);
    }
    return ids;
  } catch {
    return [];
  }
}

export function saveFavorites(ids: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* private mode */
  }
}

/** Add the id, or remove it if it is already stored. Order of other ids stays put. */
export function toggleFavorite(ids: readonly string[], gameId: string): string[] {
  if (!gameId) return [...ids];
  const next = ids.filter((id) => id !== gameId);
  if (next.length === ids.length) next.push(gameId);
  return next;
}

/**
 * Favorites first, then the rest. Each group keeps catalog order
 * (`order` is the index in the unfiltered catalog).
 */
export function sortByFavorite<T extends { id: string }>(
  games: readonly T[],
  favoriteIds: readonly string[],
  order: ReadonlyMap<string, number>,
): T[] {
  const favorite = new Set(favoriteIds);
  return games.slice().sort((a, b) => {
    const group = (favorite.has(a.id) ? 0 : 1) - (favorite.has(b.id) ? 0 : 1);
    if (group !== 0) return group;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
}
