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
mkdir -p "$HOME/.hermes/skills"
cp "$DEST_DIR/skills/chess.md" "$HOME/.hermes/skills/chess.md"

echo "⚙️  Configuring Hermes MCP Server..."
CONFIG_FILE="$HOME/.hermes/config.yaml"

# Check if config exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "mcp_servers:" > "$CONFIG_FILE"
fi

# Remove existing chess entry if any (basic sed, assumes simple structure)
# A safer way is to just append if not exists, or instruct user.
if grep -q "mcp_servers:" "$CONFIG_FILE"; then
    if ! grep -q "chess:" "$CONFIG_FILE"; then
        cat >> "$CONFIG_FILE" << EOF

  chess:
    command: "node"
    args: ["$DEST_DIR/server/index.js"]
    supports_parallel_tool_calls: false
EOF
    else
        echo "⚠️  'chess' MCP server already exists in config.yaml. Please ensure it points to $DEST_DIR/server/index.js"
    fi
else
    echo "mcp_servers:" >> "$CONFIG_FILE"
    cat >> "$CONFIG_FILE" << EOF
  chess:
    command: "node"
    args: ["$DEST_DIR/server/index.js"]
    supports_parallel_tool_calls: false
EOF
fi

echo "✅ Installation complete!"
echo "🚀 Start your Hermes Agent and say: 'let's play chess'"
