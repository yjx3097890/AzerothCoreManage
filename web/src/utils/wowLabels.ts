/** WotLK class / race labels for UI fallback when API omits localized names. */

const CLASS_ZH: Record<number, string> = {
  1: '战士',
  2: '圣骑士',
  3: '猎人',
  4: '潜行者',
  5: '牧师',
  6: '死亡骑士',
  7: '萨满祭司',
  8: '法师',
  9: '术士',
  11: '德鲁伊',
}

const CLASS_EN: Record<number, string> = {
  1: 'Warrior',
  2: 'Paladin',
  3: 'Hunter',
  4: 'Rogue',
  5: 'Priest',
  6: 'Death Knight',
  7: 'Shaman',
  8: 'Mage',
  9: 'Warlock',
  11: 'Druid',
}

export function classLabel(id: number, locale = 'zh-CN', fallbackName?: string): string {
  const table = locale.startsWith('zh') ? CLASS_ZH : CLASS_EN
  if (table[id]) return table[id]
  if (fallbackName) return fallbackName
  return String(id)
}

/** WotLK gender: 0 male, 1 female. */
export function genderLabel(id: number, locale = 'zh-CN'): string {
  const zh = locale.startsWith('zh')
  if (id === 0) return zh ? '男' : 'Male'
  if (id === 1) return zh ? '女' : 'Female'
  return String(id)
}
