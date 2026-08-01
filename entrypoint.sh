#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/app}"
DISPLAY="${DISPLAY:-:99}"
SCREEN_WIDTH="${SCREEN_WIDTH:-1365}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-768}"
SCREEN_DEPTH="${SCREEN_DEPTH:-24}"
ENABLE_NOVNC="${ENABLE_NOVNC:-true}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
VNC_PASSWORD="${VNC_PASSWORD:-}"

export DISPLAY
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"
export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"

mkdir -p "$APP_DIR/logs" "$APP_DIR/data" "$APP_DIR/backups" "$APP_DIR/browser_data"
rm -f "/tmp/.X${DISPLAY#:}-lock"

if [ "$ENABLE_NOVNC" = "true" ] || [ "$ENABLE_NOVNC" = "1" ]; then
  Xvfb "$DISPLAY" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" -ac +extension RANDR > /tmp/xvfb.log 2>&1 &
  sleep 0.5

  if command -v fluxbox >/dev/null 2>&1; then
    fluxbox > /tmp/fluxbox.log 2>&1 &
  fi

  if [ -n "$VNC_PASSWORD" ]; then
    mkdir -p /root/.vnc
    x11vnc -storepasswd "$VNC_PASSWORD" /root/.vnc/passwd >/tmp/x11vnc-passwd.log 2>&1
    x11vnc -display "$DISPLAY" -forever -shared -rfbport "$VNC_PORT" -rfbauth /root/.vnc/passwd > /tmp/x11vnc.log 2>&1 &
  else
    x11vnc -display "$DISPLAY" -forever -shared -rfbport "$VNC_PORT" -nopw > /tmp/x11vnc.log 2>&1 &
  fi

  if command -v websockify >/dev/null 2>&1; then
    NOVNC_WEB_DIR="/usr/share/novnc"
    if [ ! -d "$NOVNC_WEB_DIR" ] && [ -d "/usr/share/noVNC" ]; then
      NOVNC_WEB_DIR="/usr/share/noVNC"
    fi
    websockify --web="$NOVNC_WEB_DIR" "$NOVNC_PORT" "127.0.0.1:$VNC_PORT" > /tmp/novnc.log 2>&1 &
  fi
fi

cd "$APP_DIR"
exec python Start.py
