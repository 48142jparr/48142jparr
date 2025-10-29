#!/usr/bin/env zsh
# Safe helper to run the Git setup commands you provided.
# Usage: ./git-setup.sh

set -euo pipefail

REPO_DIR="/Users/parrish/Library/CloudStorage/OneDrive-GoToTechnologiesUSALLC/GoTo/API/User Activity Summary"
REMOTE_URL="git@github.com:48142jparr/48142jparr.git"

echo "Repository directory: $REPO_DIR"
cd "$REPO_DIR" || { echo "Failed to cd to $REPO_DIR"; exit 1; }

# Initialize repo if needed
if [ -d .git ]; then
  echo ".git already exists — reinitializing (safe)"
  git init
else
  echo "Initializing git repository"
  git init
fi

# Add and commit
echo "Staging all files..."
git add .

echo "Committing..."
if git commit -m "chore: initial commit"; then
  echo "Committed"
else
  echo "No changes to commit or commit failed — continuing"
fi

# Ensure main branch
echo "Setting main branch"
git branch -M main || true

# Add or update origin
if git remote get-url origin >/dev/null 2>&1; then
  echo "Updating origin URL to $REMOTE_URL"
  git remote set-url origin "$REMOTE_URL"
else
  echo "Adding origin $REMOTE_URL"
  git remote add origin "$REMOTE_URL"
fi

# Push (may require SSH key or credentials configured)
echo "Pushing main to origin (may prompt for credentials or fail if not configured)"
if git push -u origin main; then
  echo "Pushed main to origin"
else
  echo "Push failed — check your network/authentication and run: git push -u origin main"
fi

echo "Done"
