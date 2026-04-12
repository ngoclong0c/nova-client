#!/bin/bash
# Usage: ./scripts/release.sh 0.1.1
# Hoặc dùng Python: python server/version_server.py 0.1.1

set -e

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Hoac:  python server/version_server.py <version>"
  exit 1
fi

# Validate version format (x.y.z)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: Version must be in format x.y.z (e.g. 0.1.1)"
  exit 1
fi

# Dùng script Python để cập nhật tất cả file + push
python3 "$(dirname "$0")/../server/version_server.py" "$VERSION"
