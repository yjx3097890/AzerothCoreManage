package httpapi

import "fmt"

// itemNameExpr returns SQL selecting localized item name (zhCN preferred).
// aliasIT = item_template alias, aliasLoc = locale alias.
func itemNameExpr(aliasIT, aliasLoc string) string {
	return fmt.Sprintf("COALESCE(NULLIF(%s.Name,''), %s.name, '')", aliasLoc, aliasIT)
}

func itemLocaleJoin(worldDB, aliasIT, aliasLoc string) string {
	return fmt.Sprintf(
		"LEFT JOIN %s.item_template_locale %s ON %s.ID = %s.entry AND %s.locale = 'zhCN'",
		worldDB, aliasLoc, aliasLoc, aliasIT, aliasLoc,
	)
}
