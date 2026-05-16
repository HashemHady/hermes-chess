# Hermes Chess

Play chess against your local AI agent. 

Hermes Chess connects the [Hermes Agent](https://github.com/nousresearch/hermes-agent) to a local browser-based chess UI using the Model Context Protocol (MCP). It features a hybrid engine where Stockfish generates unranked candidate moves, but Hermes's underlying LLM analyzes the board and chooses the final move based on its personality.

## Features
- **Browser UI:** Full chess board, move history, captured pieces tray, and chat.
- **Agent Integration:** All interactions (moving, chatting, takebacks, draws) are handled seamlessly through the Hermes Agent as an MCP client.
- **Personality:** Play against an agent that talks back, reacts to blunders, and offers coaching.
- **Persistence:** Games are automatically archived to a local SQLite database for later review.

## Prerequisites
- **Node.js** v18+
- **Hermes Agent** installed and configured.

## Installation

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/HashemHady/hermes-chess/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/HashemHady/hermes-chess/main/install.ps1 | iex
```

*The installer will clone the repository to `~/.hermes-chess`, install dependencies, copy the skill file to `~/.hermes/skills/`, and update your `~/.hermes/config.yaml` automatically.*

## How to Play

1. Start your Hermes Agent as usual (e.g., via CLI).
2. Type `/chess` or simply say **"Let's play chess!"**
3. Hermes will automatically launch your default browser and ask you to pick a side.
4. Play! You can chat with Hermes through the browser or directly in the terminal/gateway.

## Uninstallation

**macOS / Linux:**
```bash
~/.hermes-chess/uninstall.sh
```

**Windows:**
```powershell
~/.hermes-chess/uninstall.ps1
```

*Note: You may need to manually remove the `chess` server entry from your `~/.hermes/config.yaml`.*

## Architecture
This project uses:
- `@modelcontextprotocol/sdk` (stdio transport)
- `chess.js` (game rules & validation)
- `chessboardjs` (UI rendering)
- `better-sqlite3` (persistence)
- `Stockfish` (candidate move generation via UCI)
# hermes-chess
