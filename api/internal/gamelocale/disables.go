package gamelocale

import (
	"regexp"
	"strconv"
	"strings"

	"acmanage/internal/i18n"
)

// Disable sourceType values (DisableMgr.h / wiki).
const (
	DisableSpell               = 0
	DisableQuest               = 1
	DisableMap                 = 2
	DisableBattleground        = 3
	DisableAchievementCriteria = 4
	DisableOutdoorPVP          = 5
	DisableVMAP                = 6
	DisableGOLOS               = 7 // historically also called MMAP in some docs
	DisableLFGMap              = 8
	DisableGameEvent           = 9
	DisableLoot                = 10
)

var disableSourceZH = map[int]string{
	0:  "法术",
	1:  "任务",
	2:  "地图",
	3:  "战场",
	4:  "成就条件",
	5:  "户外 PvP",
	6:  "VMAP",
	7:  "游戏物体视线",
	8:  "随机本地图",
	9:  "世界事件",
	10: "掉落",
}

var disableSourceEN = map[int]string{
	0:  "Spell",
	1:  "Quest",
	2:  "Map",
	3:  "Battleground",
	4:  "Achievement criteria",
	5:  "Outdoor PvP",
	6:  "VMAP",
	7:  "GameObject LOS",
	8:  "LFG map",
	9:  "Game event",
	10: "Loot",
}

var spellFlagZH = []struct {
	bit uint32
	zh  string
	en  string
}{
	{1, "玩家", "Player"},
	{2, "生物", "Creature"},
	{4, "宠物", "Pet"},
	{8, "完全禁用/废弃", "Deprecated/fully disabled"},
	{16, "指定地图", "MapId"},
	{32, "指定地区", "AreaId"},
	{64, "忽略视线", "Ignore LOS"},
}

var mapFlagZH = []struct {
	bit uint32
	zh  string
	en  string
}{
	{1, "普通/10人普通", "Normal / 10-normal"},
	{2, "英雄/25人普通", "Heroic / 25-normal"},
	{4, "10人英雄", "10-heroic"},
	{8, "25人英雄", "25-heroic"},
}

var vmapFlagZH = []struct {
	bit uint32
	zh  string
	en  string
}{
	{1, "区域标记", "Area flag"},
	{2, "高度", "Height"},
	{4, "视线", "LOS"},
	{8, "液体", "Liquid"},
}

func DisableSourceName(sourceType int, loc i18n.Locale) string {
	table := disableSourceZH
	if loc == i18n.EN {
		table = disableSourceEN
	}
	if n := table[sourceType]; n != "" {
		return n
	}
	return strconv.Itoa(sourceType)
}

func DisableFlagsText(sourceType int, flags uint32, loc i18n.Locale) string {
	if flags == 0 {
		if loc == i18n.EN {
			return "None"
		}
		return "无"
	}
	var bits []struct {
		bit uint32
		zh  string
		en  string
	}
	switch sourceType {
	case DisableSpell:
		bits = spellFlagZH
	case DisableMap, DisableLFGMap:
		bits = mapFlagZH
	case DisableVMAP:
		bits = vmapFlagZH
	default:
		return strconv.FormatUint(uint64(flags), 10)
	}
	parts := make([]string, 0, 4)
	known := uint32(0)
	for _, b := range bits {
		if flags&b.bit != 0 {
			known |= b.bit
			if loc == i18n.EN {
				parts = append(parts, b.en)
			} else {
				parts = append(parts, b.zh)
			}
		}
	}
	if rest := flags &^ known; rest != 0 {
		parts = append(parts, "0x"+strconv.FormatUint(uint64(rest), 16))
	}
	if len(parts) == 0 {
		return strconv.FormatUint(uint64(flags), 10)
	}
	return strings.Join(parts, " · ")
}

var (
	reSpellDeprItem = regexp.MustCompile(`(?i)^Spell for deprecated item(?:\s+(\d+))?$`)
	reDeprQuest     = regexp.MustCompile(`(?i)^Deprecated\s+quests?\s*:?\s*(.*)$`)
	reDisableQuest  = regexp.MustCompile(`(?i)^Disable\s+Quest\s+(.+)$`)
	reIgnoreLOS     = regexp.MustCompile(`(?i)^(?:Ignore|Disable)\s+LOS\s+for\s+(.+)$`)
	reIgnoreLoSEnd  = regexp.MustCompile(`(?i)^(.+?)\s*[-–]?\s*Ignore\s+LoS$`)
	reIgnoreLosParen = regexp.MustCompile(`(?i)^(.+?)\s*\(Ignore\s+Los\)$`)
	reDisableVmaps  = regexp.MustCompile(`(?i)^Disable\s+Vmaps?\s+for\s+(.+)$`)
	reDisableOf     = regexp.MustCompile(`(?i)^Disable\s+of\s+(.+)$`)
	reChainedLOS    = regexp.MustCompile(`(?i)^Chained Peasant \(Chest\) LOS$`)
)

// LocalizeDisableComment translates common English disable comments when locale is zh-CN.
func LocalizeDisableComment(comment string, loc i18n.Locale) string {
	c := strings.TrimSpace(comment)
	if c == "" || loc != i18n.ZH {
		return c
	}
	if m := reSpellDeprItem.FindStringSubmatch(c); m != nil {
		if m[1] != "" {
			return "废弃物品 " + m[1] + " 的法术"
		}
		return "废弃物品的法术"
	}
	if m := reDeprQuest.FindStringSubmatch(c); m != nil {
		rest := strings.TrimSpace(m[1])
		if rest == "" {
			return "废弃任务"
		}
		return "废弃任务：" + rest
	}
	if m := reDisableQuest.FindStringSubmatch(c); m != nil {
		return "禁用任务：" + strings.TrimSpace(m[1])
	}
	if m := reIgnoreLOS.FindStringSubmatch(c); m != nil {
		return "忽略视线：" + strings.TrimSpace(m[1])
	}
	if m := reIgnoreLoSEnd.FindStringSubmatch(c); m != nil {
		return strings.TrimSpace(m[1]) + "（忽略视线）"
	}
	if m := reIgnoreLosParen.FindStringSubmatch(c); m != nil {
		return strings.TrimSpace(m[1]) + "（忽略视线）"
	}
	if m := reDisableVmaps.FindStringSubmatch(c); m != nil {
		return "禁用 VMAP：" + strings.TrimSpace(m[1])
	}
	if m := reDisableOf.FindStringSubmatch(c); m != nil {
		return "禁用：" + strings.TrimSpace(m[1])
	}
	if reChainedLOS.MatchString(c) {
		return "被缚的农民（箱子）视线"
	}
	switch strings.ToLower(c) {
	case "temp":
		return "临时"
	case "traveler's tundra mammoth":
		return "旅行者的苔原猛犸象"
	}
	if strings.Contains(strings.ToLower(c), "can crash client") {
		return strings.ReplaceAll(c, "can crash client by spawning too many totems", "会因召唤过多图腾导致客户端崩溃")
	}
	if strings.HasPrefix(strings.ToLower(c), "unfinished gordok business") {
		return "未完成的戈多克事务（由 7703 替代）"
	}
	return c
}
