package httpapi

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"acmanage/internal/gamelocale"
	"acmanage/internal/i18n"

	"github.com/gin-gonic/gin"
)

func (s *Server) catalogItems(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "80"))
	if limit <= 0 || limit > 300 {
		limit = 80
	}
	loc := i18n.FromRequest(c)
	preferZH := loc != i18n.EN

	ctx := c.Request.Context()
	var (
		rows *sql.Rows
		err  error
	)
	// Empty query: do not dump the first N low-entry junk items; client searches by name/ID.
	if q == "" {
		JSON(c, gin.H{"items": []gin.H{}, "hint": "search_required"})
		return
	}

	base := `
SELECT it.entry, it.name,
       COALESCE(NULLIF(l.Name,''), it.name) AS name_zh
FROM item_template it
LEFT JOIN item_template_locale l ON l.ID = it.entry AND l.locale = 'zhCN'`

	if id, errAtoi := strconv.Atoi(q); errAtoi == nil {
		like := "%" + q + "%"
		prefix := q + "%"
		rows, err = rt.DB.World.QueryContext(ctx, base+`
WHERE it.entry = ? OR CAST(it.entry AS CHAR) LIKE ? OR it.name LIKE ? OR l.Name LIKE ?
ORDER BY
  (it.entry = ?) DESC,
  (CAST(it.entry AS CHAR) LIKE ?) DESC,
  (it.name LIKE ? OR l.Name LIKE ?) DESC,
  it.Quality DESC,
  it.entry
LIMIT ?`, id, like, like, like, id, prefix, prefix, prefix, limit)
	} else {
		like := "%" + q + "%"
		prefix := q + "%"
		rows, err = rt.DB.World.QueryContext(ctx, base+`
WHERE it.name LIKE ? OR l.Name LIKE ? OR CAST(it.entry AS CHAR) LIKE ?
ORDER BY
  (it.name LIKE ? OR l.Name LIKE ?) DESC,
  (it.name LIKE ? OR l.Name LIKE ?) DESC,
  it.Quality DESC,
  it.ItemLevel DESC,
  it.entry
LIMIT ?`, like, like, like, q, q, prefix, prefix, limit)
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()

	items := []gin.H{}
	for rows.Next() {
		var entry uint32
		var nameEN, nameZH string
		if err := rows.Scan(&entry, &nameEN, &nameZH); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		display := nameEN
		if preferZH && nameZH != "" {
			display = nameZH
		}
		items = append(items, gin.H{
			"id":      entry,
			"entry":   entry,
			"name":    display,
			"name_en": nameEN,
			"name_zh": nameZH,
		})
	}
	JSON(c, gin.H{"items": items})
}

func (s *Server) catalogMaps(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "80"))
	loc := i18n.FromRequest(c)
	rows := gamelocale.SearchMaps(q, limit, loc)
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, gin.H{
			"id": row.ID, "name": row.Name,
			"name_en": row.NameEN, "name_zh": row.NameZH,
		})
	}
	JSON(c, gin.H{"items": items})
}

func (s *Server) catalogAreas(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "80"))
	loc := i18n.FromRequest(c)
	rows := gamelocale.SearchAreas(q, limit, loc)
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, gin.H{
			"id": row.ID, "name": row.Name,
			"name_en": row.NameEN, "name_zh": row.NameZH,
		})
	}
	JSON(c, gin.H{"items": items})
}

func (s *Server) catalogEvents(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "500"))
	loc := i18n.FromRequest(c)
	rows := gamelocale.SearchEvents(q, limit, loc)
	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		items = append(items, gin.H{
			"id": row.ID, "name": row.Name,
			"name_en": row.NameEN, "name_zh": row.NameZH,
		})
	}
	JSON(c, gin.H{"items": items})
}
