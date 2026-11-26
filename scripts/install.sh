#!/usr/bin/env bash
set -euo pipefail

VERSION="${MINDQUEST_VERSION:-v0.0.0}"
REPOSITORY="migueljocode/mindquest"
INSTALL_DIR="${MINDQUEST_INSTALL_DIR:-$HOME/.local/opt/mindquest}"
BIN_DIR="${MINDQUEST_BIN_DIR:-$HOME/.local/bin}"

case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64)
    RID="linux-x64"
    ARCHIVE="mindquest-linux-x64.tar.gz"
    ;;
  Darwin:arm64|Darwin:aarch64)
    RID="osx-arm64"
    ARCHIVE="mindquest-osx-arm64.tar.gz"
    ;;
  *)
    printf 'Unsupported platform: %s (%s). Supported: Linux x64 and macOS arm64.\n' \
      "$(uname -s)" "$(uname -m)" >&2
    exit 1
    ;;
esac

if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  echo "This installer requires curl and tar." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM_COMMAND="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  CHECKSUM_COMMAND="shasum"
else
  echo "This installer requires sha256sum or shasum for checksum verification." >&2
  exit 1
fi

RELEASE_URL="https://github.com/$REPOSITORY/releases/download/$VERSION"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "Downloading MindQuest $VERSION for $RID..."
curl --fail --location --silent --show-error "$RELEASE_URL/$ARCHIVE" -o "$TEMP_DIR/$ARCHIVE"
curl --fail --location --silent --show-error "$RELEASE_URL/SHA256SUMS" -o "$TEMP_DIR/SHA256SUMS"

(
  cd "$TEMP_DIR"
  if [[ "$CHECKSUM_COMMAND" == "sha256sum" ]]; then
    grep -F "  $ARCHIVE" SHA256SUMS | sha256sum --check -
  else
    grep -F "  $ARCHIVE" SHA256SUMS | shasum -a 256 --check -
  fi
)

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$INSTALL_DIR"

escape_single_quotes() {
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
}

QUOTED_INSTALL_DIR="'$(escape_single_quotes "$INSTALL_DIR")'"
QUOTED_EXECUTABLE="'$(escape_single_quotes "$INSTALL_DIR/MindQuest")'"
cat > "$BIN_DIR/mindquest" <<EOF
#!/bin/sh
cd $QUOTED_INSTALL_DIR
exec $QUOTED_EXECUTABLE "\$@"
EOF
chmod +x "$BIN_DIR/mindquest"

echo "Installed MindQuest to $INSTALL_DIR"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Add $BIN_DIR to your PATH to run 'mindquest' from any terminal."
fi
echo "Run: mindquest --port 8080 --no-https"
