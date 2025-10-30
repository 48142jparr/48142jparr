#!/usr/bin/env bash
set -euo pipefail

# Snapshot the repository: commit, create a backup branch + tag, and push them
# REPO_DIR may be overridden by setting the REPO_DIR environment variable when running the script
REPO_DIR="${REPO_DIR:-/Users/parrish/Library/CloudStorage/OneDrive-GoToTechnologiesUSALLC/GoTo/API/User Activity Summary}"

# If the expected REPO_DIR doesn't exist (e.g. running on GitHub-hosted runner), fallback to the current workspace
if [ ! -d "$REPO_DIR" ]; then
  echo "REPO_DIR '$REPO_DIR' not found; using current working directory"
  REPO_DIR="$PWD"
fi

cd "$REPO_DIR"

# Stage all changes
git add .

COMMITTED=false
# Commit if there are changes
if git commit -m "chore: snapshot $(date -u '+%Y-%m-%d %H:%M UTC')"; then
  echo "Committed changes"
  COMMITTED=true
else
  echo "No changes to commit"
fi

# Create timestamp
TS=$(date -u '+%Y%m%d-%H%M')
BRANCH_NAME="backup-$TS"
TAG_NAME="snapshot-$TS"

if [ "$COMMITTED" = "false" ]; then
  echo "No commit created; skipping branch/tag creation and push"
  echo "Snapshot skipped: no changes"
  exit 0
fi

# Create branch if it doesn't exist
if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
  echo "Branch $BRANCH_NAME already exists"
else
  git branch "$BRANCH_NAME"
  echo "Created branch $BRANCH_NAME"
fi

# Create annotated tag
if git rev-parse --verify "refs/tags/$TAG_NAME" >/dev/null 2>&1; then
  echo "Tag $TAG_NAME already exists"
else
  git tag -a "$TAG_NAME" -m "snapshot $TS"
  echo "Created tag $TAG_NAME"
fi

# Push branch and tag to origin (if origin exists)
if git remote get-url origin >/dev/null 2>&1; then
  echo "Pushing $BRANCH_NAME and $TAG_NAME to origin"
  git push -u origin "$BRANCH_NAME" || echo "Failed to push branch"
  git push origin "$TAG_NAME" || echo "Failed to push tag"
else
  echo "No origin remote configured; skipping push"
fi

echo "Snapshot complete: branch=$BRANCH_NAME tag=$TAG_NAME"
