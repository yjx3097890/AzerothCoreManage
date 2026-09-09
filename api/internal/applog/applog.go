package applog

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"

	"gopkg.in/natefinch/lumberjack.v2"
)

// Setup configures standard library log + returns a multi-writer for Gin.
// Files land in dir as app.log (all) and error.log (4xx/5xx and Errorf).
func Setup(dir string) (access io.Writer, cleanup func()) {
	if dir == "" {
		dir = "logs"
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("applog: mkdir %s: %v (fallback stdout only)", dir, err)
		return os.Stdout, func() {}
	}

	appFile := &lumberjack.Logger{
		Filename:   filepath.Join(dir, "app.log"),
		MaxSize:    50, // MB
		MaxBackups: 10,
		MaxAge:     30, // days
		Compress:   true,
		LocalTime:  true,
	}
	errFile := &lumberjack.Logger{
		Filename:   filepath.Join(dir, "error.log"),
		MaxSize:    50,
		MaxBackups: 10,
		MaxAge:     30,
		Compress:   true,
		LocalTime:  true,
	}

	log.SetOutput(io.MultiWriter(os.Stdout, appFile))
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds | log.LUTC | log.Lshortfile)

	access = io.MultiWriter(os.Stdout, appFile)
	errorWriter = io.MultiWriter(os.Stderr, errFile, appFile)
	cleanup = func() {
		_ = appFile.Close()
		_ = errFile.Close()
	}
	return access, cleanup
}

var errorWriter io.Writer = os.Stderr

func ErrorWriter() io.Writer {
	return errorWriter
}

func Errorf(format string, args ...any) {
	_ = log.New(errorWriter, "", log.Ldate|log.Ltime|log.Lmicroseconds|log.LUTC|log.Lshortfile).
		Output(2, fmt.Sprintf(format, args...))
}
