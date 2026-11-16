/** Normalize Unicode text before searching, independent of SQLite's ASCII-only lower(). */
export function normalizeProductSearchText(value: string): string {
  return value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}
