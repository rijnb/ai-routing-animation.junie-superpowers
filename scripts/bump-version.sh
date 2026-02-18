#!/usr/bin/env bash
# Bump the app version in both package.json and src/version.ts.
# Usage: ./scripts/bump-version.sh <new-version>
# Example: ./scripts/bump-version.sh 1.2.0

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 1.2.0"
  exit 1
fi

NEW_VERSION="$1"

# Validate semver format (basic check).
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: Version must be in semver format (e.g., 1.2.3)"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Update package.json.
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$ROOT_DIR/package.json"

# Update src/version.ts.
sed -i '' "s/export const APP_VERSION = '[^']*'/export const APP_VERSION = '$NEW_VERSION'/" "$ROOT_DIR/src/version.ts"

echo "Version bumped to $NEW_VERSION in package.json and src/version.ts"
