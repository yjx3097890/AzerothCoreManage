package gamelocale

import "acmanage/internal/i18n"

// WotLK class IDs (ChrClasses).
var classNamesZH = map[int]string{
	1:  "战士",
	2:  "圣骑士",
	3:  "猎人",
	4:  "潜行者",
	5:  "牧师",
	6:  "死亡骑士",
	7:  "萨满祭司",
	8:  "法师",
	9:  "术士",
	11: "德鲁伊",
}

var classNamesEN = map[int]string{
	1:  "Warrior",
	2:  "Paladin",
	3:  "Hunter",
	4:  "Rogue",
	5:  "Priest",
	6:  "Death Knight",
	7:  "Shaman",
	8:  "Mage",
	9:  "Warlock",
	11: "Druid",
}

var raceNamesZH = map[int]string{
	1:  "人类",
	2:  "兽人",
	3:  "矮人",
	4:  "暗夜精灵",
	5:  "亡灵",
	6:  "牛头人",
	7:  "侏儒",
	8:  "巨魔",
	10: "血精灵",
	11: "德莱尼",
}

var raceNamesEN = map[int]string{
	1:  "Human",
	2:  "Orc",
	3:  "Dwarf",
	4:  "Night Elf",
	5:  "Undead",
	6:  "Tauren",
	7:  "Gnome",
	8:  "Troll",
	10: "Blood Elf",
	11: "Draenei",
}

func ClassName(id int, loc i18n.Locale) string {
	if loc == i18n.EN {
		if n := classNamesEN[id]; n != "" {
			return n
		}
	}
	if n := classNamesZH[id]; n != "" {
		return n
	}
	return classNamesEN[id]
}

func RaceName(id int, loc i18n.Locale) string {
	if loc == i18n.EN {
		if n := raceNamesEN[id]; n != "" {
			return n
		}
	}
	if n := raceNamesZH[id]; n != "" {
		return n
	}
	return raceNamesEN[id]
}
