#!/bin/bash
set -e

echo "🗑️  Uninstalling Hermes Chess..."

DEST_DIR="$HOME/.hermes-chess"
SKILL_FILE="$HOME/.hermes/skills/chess.md"

if [ -d "$DEST_DIR" ]; then
    echo "Removing repository..."
    rm -rf "$DEST_DIR"
fi

if [ -f "$SKILL_FILE" ]; then
    echo "Removing skill file..."
    rm "$SKILL_FILE"
fi

echo "⚠️  Please manually remove the 'chess' MCP server entry from your ~/.hermes/config.yaml"

echo "✅ Uninstallation complete."
