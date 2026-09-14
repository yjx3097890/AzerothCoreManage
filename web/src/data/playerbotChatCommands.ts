/** Curated mod-playerbots whisper/party chat commands for altbots (from ChatTriggerContext). */

export type LocaleText = { zh: string; en: string }

export type ChatCmdCategoryId =
  | 'movement'
  | 'loot'
  | 'gear'
  | 'combat'
  | 'quest'
  | 'strategy'
  | 'misc'

export type PlayerbotChatCommand = {
  id: string
  /** Exact text to send in whisper or party chat (no leading . or /) */
  cmd: string
  category: ChatCmdCategoryId
  title: LocaleText
  desc: LocaleText
}

export const CHAT_CMD_CATEGORIES: ChatCmdCategoryId[] = [
  'movement',
  'loot',
  'gear',
  'combat',
  'quest',
  'strategy',
  'misc',
]

export const PLAYERBOT_CHAT_COMMANDS: PlayerbotChatCommand[] = [
  // —— 移动 ——
  {
    id: 'follow',
    cmd: 'follow',
    category: 'movement',
    title: { zh: '跟随', en: 'Follow' },
    desc: { zh: '跟随你移动（最常用）', en: 'Follow you (most used)' },
  },
  {
    id: 'stay',
    cmd: 'stay',
    category: 'movement',
    title: { zh: '原地待命', en: 'Stay' },
    desc: { zh: '停在当前位置，不再跟随', en: 'Hold position; stop following' },
  },
  {
    id: 'flee',
    cmd: 'flee',
    category: 'movement',
    title: { zh: '逃跑', en: 'Flee' },
    desc: { zh: '脱离战斗并向安全方向逃跑', en: 'Disengage and run to safety' },
  },
  {
    id: 'runaway',
    cmd: 'runaway',
    category: 'movement',
    title: { zh: '走开', en: 'Run away' },
    desc: { zh: '离开你一段距离', en: 'Move away from you' },
  },
  {
    id: 'grind',
    cmd: 'grind',
    category: 'movement',
    title: { zh: '刷怪模式', en: 'Grind' },
    desc: { zh: '自行附近刷怪（不紧跟）', en: 'Grind nearby mobs on their own' },
  },
  {
    id: 'moveFromGroup',
    cmd: 'move from group',
    category: 'movement',
    title: { zh: '离开队伍站位', en: 'Move from group' },
    desc: { zh: '从队伍堆叠位置散开', en: 'Spread out from the group stack' },
  },
  {
    id: 'summon',
    cmd: 'summon',
    category: 'movement',
    title: { zh: '召唤到身边', en: 'Summon' },
    desc: { zh: '请求把你传送到机器人旁（视模块规则）', en: 'Request summon to the bot (module rules apply)' },
  },
  {
    id: 'home',
    cmd: 'home',
    category: 'movement',
    title: { zh: '炉石', en: 'Hearthstone' },
    desc: { zh: '使用炉石回城', en: 'Use hearthstone' },
  },
  {
    id: 'taxi',
    cmd: 'taxi',
    category: 'movement',
    title: { zh: '飞艇/飞行点', en: 'Taxi' },
    desc: { zh: '使用附近飞行管理员', en: 'Use nearby flight master' },
  },
  {
    id: 'teleport',
    cmd: 'teleport',
    category: 'movement',
    title: { zh: '传送', en: 'Teleport' },
    desc: { zh: '使用附近传送相关交互', en: 'Use nearby teleport interaction' },
  },

  // —— 拾取 / 买卖 ——
  {
    id: 'sGray',
    cmd: 's gray',
    category: 'loot',
    title: { zh: '卖灰色物品', en: 'Sell gray' },
    desc: { zh: '对商人出售灰色垃圾（需靠近商人）', en: 'Sell gray junk to a vendor (must be near one)' },
  },
  {
    id: 'sAll',
    cmd: 's *',
    category: 'loot',
    title: { zh: '卖全部可卖', en: 'Sell all' },
    desc: { zh: '按默认规则向商人出售物品', en: 'Sell items to vendor by default rules' },
  },
  {
    id: 'buy',
    cmd: 'b',
    category: 'loot',
    title: { zh: '购买', en: 'Buy' },
    desc: { zh: '购买物品：b 物品名（需打开商人）', en: 'Buy item: b <item name> (vendor open)' },
  },
  {
    id: 'llGray',
    cmd: 'll gray',
    category: 'loot',
    title: { zh: '只拾取灰色', en: 'Loot list gray' },
    desc: { zh: '设置拾取策略为灰色等（ll 后跟品质/规则）', en: 'Set loot strategy (ll + quality/rule)' },
  },
  {
    id: 'llAll',
    cmd: 'll *',
    category: 'loot',
    title: { zh: '拾取全部', en: 'Loot all qualities' },
    desc: { zh: '拾取策略设为全部', en: 'Loot strategy: everything' },
  },
  {
    id: 'lootAll',
    cmd: 'loot all',
    category: 'loot',
    title: { zh: '拾取周围', en: 'Loot all' },
    desc: { zh: '立刻拾取周围尸体/物品', en: 'Loot nearby corpses/items now' },
  },
  {
    id: 'repair',
    cmd: 'repair',
    category: 'loot',
    title: { zh: '修理', en: 'Repair' },
    desc: { zh: '找修理商人修理装备', en: 'Repair gear at a vendor' },
  },
  {
    id: 'bank',
    cmd: 'bank',
    category: 'loot',
    title: { zh: '银行', en: 'Bank' },
    desc: { zh: '与银行交互存取', en: 'Interact with bank' },
  },
  {
    id: 'gb',
    cmd: 'gb',
    category: 'loot',
    title: { zh: '公会银行', en: 'Guild bank' },
    desc: { zh: '与公会银行交互', en: 'Interact with guild bank' },
  },
  {
    id: 'destroy',
    cmd: 'destroy',
    category: 'loot',
    title: { zh: '摧毁物品', en: 'Destroy' },
    desc: { zh: '摧毁物品：destroy 物品名', en: 'Destroy item: destroy <item name>' },
  },
  {
    id: 'openItems',
    cmd: 'open items',
    category: 'loot',
    title: { zh: '打开容器', en: 'Open items' },
    desc: { zh: '打开背包里的箱子/包裹', en: 'Open boxes/bags in inventory' },
  },

  // —— 装备 ——
  {
    id: 'equip',
    cmd: 'e',
    category: 'gear',
    title: { zh: '装备', en: 'Equip' },
    desc: { zh: '装备物品：e 物品名', en: 'Equip item: e <item name>' },
  },
  {
    id: 'unequip',
    cmd: 'ue',
    category: 'gear',
    title: { zh: '卸下', en: 'Unequip' },
    desc: { zh: '卸下装备：ue 物品名或栏位', en: 'Unequip: ue <item or slot>' },
  },
  {
    id: 'autogear',
    cmd: 'autogear',
    category: 'gear',
    title: { zh: '自动配装', en: 'Autogear' },
    desc: { zh: '按 AutoGear 规则自动换装', en: 'Auto-equip by AutoGear rules' },
  },
  {
    id: 'autogearBis',
    cmd: 'autogear bis',
    category: 'gear',
    title: { zh: '自动配装 BIS', en: 'Autogear BIS' },
    desc: { zh: '按更高标准自动配装', en: 'Autogear with stricter (BIS) rules' },
  },
  {
    id: 'equipUpgrade',
    cmd: 'equip upgrade',
    category: 'gear',
    title: { zh: '装备升级', en: 'Equip upgrade' },
    desc: { zh: '用更好的掉落替换当前装备', en: 'Replace gear with upgrades from loot' },
  },
  {
    id: 'outfit',
    cmd: 'outfit',
    category: 'gear',
    title: { zh: '套装方案', en: 'Outfit' },
    desc: { zh: '查看/切换 outfit 方案', en: 'List or switch outfits' },
  },
  {
    id: 'talents',
    cmd: 'talents',
    category: 'gear',
    title: { zh: '天赋', en: 'Talents' },
    desc: { zh: '查看或按建议点天赋', en: 'Show or apply suggested talents' },
  },
  {
    id: 'glyphs',
    cmd: 'glyphs',
    category: 'gear',
    title: { zh: '铭文', en: 'Glyphs' },
    desc: { zh: '查看铭文相关状态', en: 'Show glyph status' },
  },
  {
    id: 'maintenance',
    cmd: 'maintenance',
    category: 'gear',
    title: { zh: '维护一轮', en: 'Maintenance' },
    desc: { zh: '修理、补给、整理等维护动作', en: 'Repair, restock, tidy-up pass' },
  },

  // —— 战斗 ——
  {
    id: 'attack',
    cmd: 'attack',
    category: 'combat',
    title: { zh: '攻击目标', en: 'Attack' },
    desc: { zh: '攻击你当前目标', en: 'Attack your current target' },
  },
  {
    id: 'tankAttack',
    cmd: 'tank attack',
    category: 'combat',
    title: { zh: '坦克开怪', en: 'Tank attack' },
    desc: { zh: '坦克优先拉怪模式', en: 'Tank pull / aggro mode' },
  },
  {
    id: 'maxDps',
    cmd: 'max dps',
    category: 'combat',
    title: { zh: '全力输出', en: 'Max DPS' },
    desc: { zh: '切换到最大化 DPS 行为', en: 'Switch to max-DPS behavior' },
  },
  {
    id: 'pull',
    cmd: 'pull',
    category: 'combat',
    title: { zh: '拉怪', en: 'Pull' },
    desc: { zh: '按拉怪策略开怪', en: 'Pull using pull strategy' },
  },
  {
    id: 'pullBack',
    cmd: 'pull back',
    category: 'combat',
    title: { zh: '拉回', en: 'Pull back' },
    desc: { zh: '拉怪后回到站位', en: 'Return to pull position' },
  },
  {
    id: 'revive',
    cmd: 'revive',
    category: 'combat',
    title: { zh: '复活', en: 'Revive' },
    desc: { zh: '复活附近队友/自己（职业相关）', en: 'Revive nearby ally / self (class-dependent)' },
  },
  {
    id: 'buff',
    cmd: 'buff',
    category: 'combat',
    title: { zh: '补 Buff', en: 'Buff' },
    desc: { zh: '给队伍补增益', en: 'Reapply party buffs' },
  },
  {
    id: 'rebuff',
    cmd: 'rebuff',
    category: 'combat',
    title: { zh: '强制重 Buff', en: 'Rebuff' },
    desc: { zh: '强制重新施放增益', en: 'Force rebuff' },
  },
  {
    id: 'drink',
    cmd: 'drink',
    category: 'combat',
    title: { zh: '喝水/进食', en: 'Drink' },
    desc: { zh: '喝水或进食回蓝血', en: 'Drink/eat to recover' },
  },
  {
    id: 'saveMana',
    cmd: 'save mana',
    category: 'combat',
    title: { zh: '省蓝', en: 'Save mana' },
    desc: { zh: '切换省蓝战斗模式', en: 'Toggle mana-saving combat mode' },
  },
  {
    id: 'rti',
    cmd: 'rti',
    category: 'combat',
    title: { zh: '标记目标', en: 'RTI' },
    desc: { zh: '按团队标记攻击：rti skull 等', en: 'Attack by raid icon: rti skull, etc.' },
  },
  {
    id: 'focusHeal',
    cmd: 'focus heal',
    category: 'combat',
    title: { zh: '集中治疗', en: 'Focus heal' },
    desc: { zh: '优先治疗指定目标', en: 'Prioritize healing a focus target' },
  },
  {
    id: 'petAttack',
    cmd: 'pet attack',
    category: 'combat',
    title: { zh: '宠物攻击', en: 'Pet attack' },
    desc: { zh: '命令宠物攻击当前目标', en: 'Order pet to attack current target' },
  },

  // —— 任务 ——
  {
    id: 'q',
    cmd: 'q',
    category: 'quest',
    title: { zh: '任务列表', en: 'Quests' },
    desc: { zh: '查看任务相关状态：q', en: 'Show quest status: q' },
  },
  {
    id: 'accept',
    cmd: 'accept',
    category: 'quest',
    title: { zh: '接任务', en: 'Accept' },
    desc: { zh: '接受当前 NPC 任务', en: 'Accept quest from current NPC' },
  },
  {
    id: 'share',
    cmd: 'share',
    category: 'quest',
    title: { zh: '共享任务', en: 'Share' },
    desc: { zh: '共享可共享的任务', en: 'Share shareable quests' },
  },
  {
    id: 'talk',
    cmd: 'talk',
    category: 'quest',
    title: { zh: '对话', en: 'Talk' },
    desc: { zh: '与目标 NPC 对话', en: 'Talk to target NPC' },
  },
  {
    id: 'trainer',
    cmd: 'trainer',
    category: 'quest',
    title: { zh: '训练师', en: 'Trainer' },
    desc: { zh: '向训练师学习技能', en: 'Learn spells from trainer' },
  },
  {
    id: 'drop',
    cmd: 'drop',
    category: 'quest',
    title: { zh: '放弃任务', en: 'Drop quest' },
    desc: { zh: '放弃任务：drop 任务名', en: 'Abandon quest: drop <quest name>' },
  },

  // —— 策略 ——
  {
    id: 'ncPlusGrind',
    cmd: 'nc +grind',
    category: 'strategy',
    title: { zh: '开启非战斗刷怪', en: 'Enable NC grind' },
    desc: { zh: '非战斗策略加上 grind', en: 'Add grind to non-combat strategies' },
  },
  {
    id: 'ncMinusGrind',
    cmd: 'nc -grind',
    category: 'strategy',
    title: { zh: '关闭非战斗刷怪', en: 'Disable NC grind' },
    desc: { zh: '非战斗策略去掉 grind', en: 'Remove grind from non-combat strategies' },
  },
  {
    id: 'coPlus',
    cmd: 'co',
    category: 'strategy',
    title: { zh: '战斗策略', en: 'Combat strategies' },
    desc: { zh: '查看/改战斗策略：co +xxx / co -xxx', en: 'List/change combat strategies: co +xxx / co -xxx' },
  },
  {
    id: 'nc',
    cmd: 'nc',
    category: 'strategy',
    title: { zh: '非战斗策略', en: 'Non-combat strategies' },
    desc: { zh: '查看/改非战斗策略：nc +xxx / nc -xxx', en: 'List/change NC strategies: nc +xxx / nc -xxx' },
  },
  {
    id: 'formation',
    cmd: 'formation',
    category: 'strategy',
    title: { zh: '队形', en: 'Formation' },
    desc: { zh: '设置跟随队形：formation near 等', en: 'Set follow formation: formation near, etc.' },
  },
  {
    id: 'stance',
    cmd: 'stance',
    category: 'strategy',
    title: { zh: '站位姿态', en: 'Stance' },
    desc: { zh: '设置战斗站位姿态', en: 'Set combat stance/positioning' },
  },
  {
    id: 'range',
    cmd: 'range',
    category: 'strategy',
    title: { zh: '攻击距离', en: 'Range' },
    desc: { zh: '设置跟战距离：range 数值', en: 'Set follow/attack range: range <n>' },
  },
  {
    id: 'resetAi',
    cmd: 'reset botAI',
    category: 'strategy',
    title: { zh: '重置 AI', en: 'Reset AI' },
    desc: { zh: '重置机器人 AI 状态（卡住时有用）', en: 'Reset bot AI state (when stuck)' },
  },

  // —— 杂项 ——
  {
    id: 'help',
    cmd: 'help',
    category: 'misc',
    title: { zh: '帮助', en: 'Help' },
    desc: { zh: '机器人回复可用命令帮助', en: 'Bot replies with command help' },
  },
  {
    id: 'who',
    cmd: 'who',
    category: 'misc',
    title: { zh: '身份', en: 'Who' },
    desc: { zh: '查看机器人简要信息', en: 'Show brief bot info' },
  },
  {
    id: 'stats',
    cmd: 'stats',
    category: 'misc',
    title: { zh: '属性', en: 'Stats' },
    desc: { zh: '查看属性摘要', en: 'Show stats summary' },
  },
  {
    id: 'leave',
    cmd: 'leave',
    category: 'misc',
    title: { zh: '离队', en: 'Leave group' },
    desc: { zh: '离开当前队伍', en: 'Leave the current group' },
  },
  {
    id: 'ready',
    cmd: 'ready',
    category: 'misc',
    title: { zh: '就位确认', en: 'Ready check' },
    desc: { zh: '响应就位确认', en: 'Respond to ready check' },
  },
  {
    id: 'cast',
    cmd: 'cast',
    category: 'misc',
    title: { zh: '施法', en: 'Cast' },
    desc: { zh: '施放技能：cast 技能名', en: 'Cast spell: cast <spell name>' },
  },
  {
    id: 'emote',
    cmd: 'emote',
    category: 'misc',
    title: { zh: '表情', en: 'Emote' },
    desc: { zh: '做表情动作', en: 'Perform an emote' },
  },
  {
    id: 'spells',
    cmd: 'spells',
    category: 'misc',
    title: { zh: '技能列表', en: 'Spells' },
    desc: { zh: '列出已学技能', en: 'List known spells' },
  },
  {
    id: 'inv',
    cmd: 'inv',
    category: 'misc',
    title: { zh: '背包', en: 'Inventory' },
    desc: { zh: '查看背包物品摘要', en: 'Show inventory summary' },
  },
]

export function pickLocaleText(text: LocaleText, lang: string): string {
  return lang.toLowerCase().startsWith('zh') ? text.zh : text.en
}
