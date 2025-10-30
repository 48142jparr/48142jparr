#!/usr/bin/env zsh
set -euo pipefail

# Snapshot the repository on a per-file basis: for each tracked or untracked file,
# compare the local content to the same path on the remote (origin/<current-branch>).
# If the file differs (or is new locally), create a per-file backup branch + tag,
# commit only that file on the backup branch, push branch+tag, then delete the
# local backup branch. Unchanged files are skipped.

REPO_DIR="/Users/parrish/Library/CloudStorage/OneDrive-GoToTechnologiesUSALLC/GoTo/API/User Activity Summary"
cd "$REPO_DIR"

# Ensure we have up-to-date remote refs
if git remote get-url origin >/dev/null 2>&1; then
  git fetch --quiet origin || true
fi

CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
TS=$(date -u '+%Y%m%d-%H%M')

# Find a sensible remote ref to compare against: prefer origin/<current-branch>, then origin/main, origin/master
REMOTE_REF=""
for cand in "origin/$CURRENT_BRANCH" origin/main origin/master origin/HEAD; do
  if git rev-parse --verify "$cand" >/dev/null 2>&1; then
    REMOTE_REF="$cand"
    break
  fi
done

# List tracked + untracked (but not ignored) files
FILES=$(git ls-files --cached --others --exclude-standard)

if [ -z "$FILES" ]; then
  echo "No files found to consider"
  exit 0
fi

echo "Comparing local files against remote ref: ${REMOTE_REF:-<no-remote-found>}"

for file in $FILES; do
  # skip .git and workflow backup artifacts if present
  if [[ "$file" == .git/* ]]; then
    continue
  fi

  changed=false

  if [ -n "$REMOTE_REF" ]; then
    # Check if the file exists on the remote ref
    if git show "$REMOTE_REF:$file" >/dev/null 2>&1; then
      # Compare remote content to local file
      if git show "$REMOTE_REF:$file" 2>/dev/null | cmp -s - "$file" 2>/dev/null; then
        echo "Unchanged: $file"
        changed=false
      else
        echo "Changed: $file"
        changed=true
      fi
    else
      # file does not exist on remote -> treat as new/changed
      echo "New locally: $file"
      changed=true
    fi
  else
    # no remote ref to compare to; treat everything as changed/new
    echo "No remote ref; treating as changed: $file"
    changed=true
  fi

  if [ "$changed" = true ]; then
    # sanitize filename for branch/tag names
    SANITIZED=$(printf "%s" "$file" | sed -E 's/[^a-zA-Z0-9]+/-/g' | sed -E 's/^-+|-+$//g' | cut -c1-80)
    BRANCH_NAME="backup-$SANITIZED-$TS"
    TAG_NAME="snapshot-$SANITIZED-$TS"

    echo "Creating backup branch $BRANCH_NAME and tag $TAG_NAME for $file"

    # Create branch from current branch reference (do not move HEAD of current branch)
    git branch "$BRANCH_NAME" "$CURRENT_BRANCH" || true
    # Checkout the backup branch
    git checkout "$BRANCH_NAME"

    # Commit only this file
    git add -- "$file"
    if git commit -m "backup: $file $TS" --no-verify; then
      echo "Committed $file on $BRANCH_NAME"
    else
      echo "No commit created for $file on $BRANCH_NAME (maybe unchanged in index)"
    fi

    # Create annotated tag on the commit
    if git rev-parse --verify "refs/tags/$TAG_NAME" >/dev/null 2>&1; then
      echo "Tag $TAG_NAME already exists"
    else
      git tag -a "$TAG_NAME" -m "snapshot $file $TS" || true
    fi

    # Push branch and tag if origin exists
    if git remote get-url origin >/dev/null 2>&1; then
      git push -u origin "$BRANCH_NAME" || echo "Failed to push branch $BRANCH_NAME"
      git push origin "$TAG_NAME" || echo "Failed to push tag $TAG_NAME"
    else
      echo "No origin remote configured; skipping push for $file"
    fi

    # Switch back to the original branch and delete local backup branch to avoid clutter
    git checkout "$CURRENT_BRANCH"
    git branch -D "$BRANCH_NAME" >/dev/null 2>&1 || true

    echo "Completed backup for $file -> branch=$BRANCH_NAME tag=$TAG_NAME"
  fi

done

echo "Per-file snapshot run complete."
