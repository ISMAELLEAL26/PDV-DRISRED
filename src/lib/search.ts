/**
 * Strips characters that have a special meaning inside a PostgREST `or=` /
 * `ilike` filter expression, so user-typed search text cannot change the
 * structure of the filter (adding extra conditions or referencing other
 * columns). Only plain search text survives.
 */
export function sanitizeFilterValue(value: string): string {
  return value
    .replace(/[,.()%*\\:"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
