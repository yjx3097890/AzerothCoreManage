/** Pick a single-language label from API locale fields. */
export function isZhLocale(lang?: string | null): boolean {
  return (lang || '').toLowerCase().startsWith('zh')
}

type Named = {
  name?: string
  name_zh?: string
  name_en?: string
  display_name?: string
}

/** UI language wins; never concatenate both languages into one label. */
export function pickLocalizedName(zhUI: boolean, row: Named): string {
  if (zhUI) {
    return (row.display_name || row.name_zh || row.name || row.name_en || '').trim()
  }
  return (row.name_en || row.name || row.display_name || row.name_zh || '').trim()
}

/** Search haystack may include both languages so users can type either. */
export function localizedSearchText(row: Named, extra: Array<string | number | undefined | null> = []): string {
  const parts = [
    row.name,
    row.name_en,
    row.name_zh,
    row.display_name,
    ...extra.map((x) => (x == null ? '' : String(x))),
  ]
  return parts.filter(Boolean).join(' ')
}
