#!/bin/bash
set -e

echo "♟️  Installing Hermes Chess..."

# Check prerequisites
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed. Please install Node.js v18+ first."
    exit 1
fi

if [ ! -d "$HOME/.hermes" ]; then
    echo "❌ Error: Hermes Agent does not seem to be installed (missing ~/.hermes directory)."
    echo "Please install Hermes Agent first: https://github.com/nousresearch/hermes-agent"
    exit 1
fi

DEST_DIR="$HOME/.hermes-chess"

if [ -d "$DEST_DIR" ]; then
    echo "⚠️  Removing existing installation..."
    rm -rf "$DEST_DIR"
fi

if [ -f "package.json" ] && [ -d "server" ]; then
    echo "📦 Local source detected. Copying files..."
    mkdir -p "$DEST_DIR"
    cp -R . "$DEST_DIR/"
else
    echo "📦 Cloning repository..."
    git clone https://github.com/HashemHady/hermes-chess.git "$DEST_DIR"
fi

echo "📦 Installing dependencies..."
cd "$DEST_DIR"
npm install

echo "🧠 Installing Hermes skill..."
mkdir -p "$HOME/.hermes/skills/hermes-chess"
cp "$DEST_DIR/skills/hermes-chess/SKILL.md" "$HOME/.hermes/skills/hermes-chess/SKILL.md"

echo "⚙️  Configuring Hermes MCP Server..."
CONFIG_FILE="$HOME/.hermes/config.yaml"

# Check if config exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "mcp_servers:" > "$CONFIG_FILE"
fi

python3 -c "
import yaml
import sys
try:
    with open('$CONFIG_FILE', 'r') as f:
        config = yaml.safe_load(f) or {}
except Exception:
    config = {}

if 'mcp_servers' not in config or not isinstance(config['mcp_servers'], dict):
    config['mcp_servers'] = {}

config['mcp_servers']['chess'] = {
    'command': 'node',
    'args': ['$DEST_DIR/server/index.js'],
    'enabled': True,
    'supports_parallel_tool_calls': False
}

with open('$CONFIG_FILE', 'w') as f:
    yaml.dump(config, f, default_flow_style=False, sort_keys=False)
"

echo "✅ Installation complete!"
echo "🚀 Start your Hermes Agent and say: 'let's play chess'"
