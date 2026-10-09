export type ScrollCoordinates = {
  left: number;
  top: number;
};

/**
 * Vue Router applies this result after navigation. `handleScroll` waits on the
 * returned value, but navigation does not wait on `handleScroll`. Return a
 * position or `false` directly so the scroll step always settles.
 */
export function resolveScrollPosition(
  saveScrollTop: boolean,
  savedPosition: ScrollCoordinates | null,
  readScrollTop: () => number
): ScrollCoordinates | false {
  if (savedPosition) return savedPosition;
  if (saveScrollTop) return { left: 0, top: readScrollTop() };
  return false;
}
