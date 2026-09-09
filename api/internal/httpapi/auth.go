package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

const (
	RoleReadonly   = "readonly"
	RoleGM         = "gm"
	RoleSuperAdmin = "superadmin"
)

func roleRank(role string) int {
	switch role {
	case RoleSuperAdmin:
		return 3
	case RoleGM:
		return 2
	case RoleReadonly:
		return 1
	default:
		return 0
	}
}

func AuthRequired(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			FailCode(c, http.StatusUnauthorized, "missing_token")
			c.Abort()
			return
		}
		tokenStr := strings.TrimPrefix(header, "Bearer ")
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			FailCode(c, http.StatusUnauthorized, "invalid_token")
			c.Abort()
			return
		}
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		c.Next()
	}
}

func RequireRole(minRole string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		roleStr, _ := role.(string)
		if roleRank(roleStr) < roleRank(minRole) {
			FailCode(c, http.StatusForbidden, "forbidden")
			c.Abort()
			return
		}
		c.Next()
	}
}

func SignToken(secret, username, role string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

func TargetID(c *gin.Context) string {
	return c.GetHeader("X-Target-Id")
}

func Username(c *gin.Context) string {
	return c.GetString("username")
}

func Role(c *gin.Context) string {
	return c.GetString("role")
}
