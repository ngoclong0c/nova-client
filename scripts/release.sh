#!/bin/bash
# Usage: ./scripts/release.sh 0.1.1
# Bumps version in package.json, commits, creates tag, and pushes to trigger release workflow.

set -e

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.1.1"
  exit 1
fi

# Validate version format (x.y.z)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: Version must be in format x.y.z (e.g. 0.1.1)"
  exit 1
fi

# Update version in package.json
node -e "
  const pkg = require('./package.json');
  pkg.version = '$VERSION';
  require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "Updated package.json to v$VERSION"

# Commit, tag, and push
git add package.json
git commit -m "release: v$VERSION"
git tag "v$VERSION"
git push origin main --tags

echo ""
echo "Done! Tag v$VERSION pushed."
echo "GitHub Actions will automatically create the release."
echo "Check: https://github.com/ngoclong0c/nova-client/actions"
