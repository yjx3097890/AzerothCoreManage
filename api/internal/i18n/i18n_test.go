package i18n

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseAndTranslate(t *testing.T) {
	if Parse("en-US,en;q=0.9") != EN {
		t.Fatal("expected en")
	}
	if Parse("zh") != ZH {
		t.Fatal("expected zh")
	}
	msg := T(EN, "not_implemented", "P0-29")
	if msg != "Skeleton placeholder, see docs/tasks.md P0-29" {
		t.Fatalf("got %q", msg)
	}
}

func TestFromRequestHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodGet, "/", nil)
	c.Request.Header.Set("X-Locale", "en-US")
	if FromRequest(c) != EN {
		t.Fatal("expected X-Locale to win")
	}
}
