# Hermes Chess — Project Overview

## Vision

A local chess system where you play against Hermes in the browser, with automatic move responses, in-game coaching, post-game review, and natural conversation — all through Hermes's existing personality and your established dynamic.

---

## Installation

### Prerequisites
- **Hermes Agent** installed and configured with an LLM provider ([install guide](https://github.com/nousresearch/hermes-agent))
- **Node.js** v18+ installed

### One-line install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/hashem/hermes-chess/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/hashem/hermes-chess/main/install.ps1 | iex
```

### What the installer does
1. Clones the repo to `~/.hermes-chess/`
2. Runs `npm install` in the server directory
3. Copies the chess skill to `~/.hermes/skills/chess.md`
4. Adds the `chess` MCP server entry to `~/.hermes/config.yaml` (with the correct absolute path)
5. Verifies Hermes is installed and the config is valid
6. Prints "Ready — say 'let's play chess' to Hermes"

### Uninstall

**macOS / Linux:**
```bash
~/.hermes-chess/uninstall.sh
```

**Windows (PowerShell):**
```powershell
~/.hermes-chess/uninstall.ps1
```

Removes the repo, skill file, and config entry. Does not touch Hermes itself.

### Repository structure

```
hermes-chess/
├── server/              # MCP server (Node.js)
│   ├── index.js         # Entry point — MCP stdio + WebSocket
│   ├── game.js          # chess.js game state management
│   ├── stockfish.js     # Stockfish UCI interface
│   ├── db.js            # SQLite persistence + game archive
│   └── package.json
├── app/
│   └── index.html       # Chess app (single file, opens in browser)
├── skills/
│   └── chess.md          # Hermes skill file (copied to ~/.hermes/skills/)
├── install.sh            # macOS/Linux installer
├── install.ps1           # Windows installer
├── uninstall.sh          # macOS/Linux uninstaller
├── uninstall.ps1         # Windows uninstaller
└── README.md             # Prerequisites + install + usage
```

---

## Architecture

```
Browser (HTML Chess App)
    ↕ WebSocket
Chess MCP Server (local Node.js)
    ↕ stdio (MCP protocol)
Hermes Agent (MCP client)
```

**Hermes is the MCP client.** It spawns the chess MCP server as a subprocess via its native MCP support. The MCP server is the bridge between Hermes and the browser — it maintains the game state and relays moves/messages over WebSocket to the HTML app.

**Two data flows:**
- **Moves** — Hermes calls MCP tools to read board state, make moves, and wait for the player's turn
- **Chat** — Hermes calls `send_message()` to push text to the browser; the player's messages are returned via the blocking `wait_for_player_input()` tool

**Turn synchronization:** The MCP server provides a blocking `wait_for_player_input()` tool. Hermes calls it after making a move — the tool blocks until the player moves or sends a chat message in the browser, then returns the input. This keeps the entire game running as a single Hermes conversation.

---

## Launch Flow

The player types `/chess` in any Hermes session (CLI, Telegram, Discord, etc.). This activates the chess skill, which triggers the full startup sequence:

```
/chess
  → Hermes activates chess skill
  → Hermes calls `open_browser()` to launch the HTML app
  → MCP server starts accepting WebSocket connections
  → Browser connects, shows side selection screen
  → Hermes calls `wait_for_player_input()` for side choice
  → Player picks white or black
  → Hermes calls `start_game(player_color)`
  → Game begins
```

The MCP server's WebSocket port and the HTML file path are configured in the server itself. `open_browser()` opens the HTML file in the default browser. Everything is automatic — one command to play.

---

## Hermes Configuration

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  chess:
    command: "node"
    args: ["/path/to/hermes-chess/server/index.js"]
    supports_parallel_tool_calls: false
```

Hermes will auto-discover all chess MCP tools at startup and register them as `mcp_chess_<tool_name>`.

---

## Components

### 1. HTML Chess App

Single `.html` file, opens in browser.

**Board panel:**
- chess.js for move validation and game logic
- Clean board UI with piece drag-and-drop
- **Piece move animations** — pieces glide smoothly to their destination, not teleport
- Move highlight (last move, legal moves on hover)
- **Check indicator** — king square flashes/highlights red when in check
- **Pawn promotion dialog** — when a pawn reaches the 8th rank, shows queen/rook/bishop/knight chooser
- Side selection screen before game starts
- Review mode (step through moves with prev/next)
- Sound effects (move, capture, check, game end)
- **Board flip button** — rotate board orientation without changing sides

**Move list panel:**
- Scrollable algebraic notation (1. e4 e5 2. Nf3 Nc6...)
- Current move highlighted
- Click any move to jump to that position (in review mode)
- Auto-scrolls to latest move during play

**Info bar:**
- **Captured pieces tray** — shows taken pieces for each side along the board edge
- **Material advantage** — shows point difference (e.g., +3)
- **Thinking time indicator** — shows elapsed time while Hermes is analyzing ("Hermes is thinking... 4s")

**Action buttons:**
- "Resign" button
- "Offer Draw" button
- **"Takeback" button** — request to undo the last move
- **"Rematch" button** — appears after game ends, starts a new game with the same settings
- **"New Game" button** — appears after game ends, returns to side selection

**Chat panel:**
- Hermes messages appear automatically
- Typing indicator while Hermes processes
- Your input field — chat mid-game or post-game
- Full scrollable history

**States:**
- `SETUP` — side selection screen, waiting for player to choose color
- `PLAYING` — active game
- `REVIEW` — game over, stepping through moves with prev/next
- `CONVERSATION` — free chat with Hermes about the game

---

### 2. MCP Server (local Node.js)

Runs locally as a subprocess spawned by Hermes. Dual role: MCP server (stdio) for Hermes + WebSocket server for the browser.

**Responsibilities:**
- Maintains authoritative game state (FEN, move history, PGN)
- Validates all moves via chess.js before applying
- Handles pawn promotion (move format: `e7e8q` for queen, `e7e8r` for rook, etc.)
- Handles illegal move retries (up to 3, then random legal move)
- Persists game state to SQLite (resume after browser close)
- Maintains game archive — all past games stored with metadata
- Provides blocking `wait_for_player_input()` to synchronize turns
- Bridges MCP tool calls ↔ WebSocket events

**Full MCP tool list:**

#### Game Management

| Tool | Description |
|------|-------------|
| `start_game(player_color)` | Initialize game, set sides |
| `end_game(reason)` | Close game (checkmate/resign/draw), trigger review mode |
| `resign()` | Hermes resigns the game |
| `offer_draw()` | Hermes offers a draw to the player |
| `respond_to_draw(accept)` | Hermes accepts or declines a player's draw offer |
| `respond_to_takeback(accept)` | Hermes accepts or declines a player's takeback request |
| `open_browser()` | Opens the HTML chess app in the default browser |

#### Board & Moves

| Tool | Description |
|------|-------------|
| `get_board_state()` | Returns current FEN string |
| `get_legal_moves()` | Returns all legal moves in current position |
| `make_move(move)` | Execute move (UCI notation, e.g., `e2e4` or `e7e8q` for promotion), validated |
| `undo_move()` | Undo the last move (used when Hermes approves a takeback) |
| `get_move_history()` | Full move list with FEN snapshot per move |
| `get_full_pgn()` | Complete game in PGN format |
| `set_position(fen)` | Set board to any position (coaching/puzzles) |
| `import_pgn(pgn)` | Load external game for review |

#### Engine Assistance

| Tool | Description |
|------|-------------|
| `get_candidate_moves(count, difficulty)` | Returns `count` Stockfish moves (default 3–5) at capped `difficulty` depth, **shuffled with no ranking or evaluation**. Each candidate includes only the move in UCI and a human-readable description (e.g., "Knight to f3, developing toward the center"). Hermes must analyze the position itself and decide which candidate to play. All candidates are legal. |
| `get_stockfish_eval(fen)` | Centipawn eval + best line (coaching/analysis only — never used during move selection) |

#### Game Archive

| Tool | Description |
|------|-------------|
| `list_games(limit)` | Returns a list of past games with date, result, player color, and move count |
| `load_game(game_id)` | Loads a past game into review mode — restores full PGN and move history |

#### Communication

| Tool | Description |
|------|-------------|
| `send_message(text)` | Push text to chat panel in browser |
| `wait_for_player_input()` | **Blocking.** Waits until the player acts. Returns one of: `{type: "move", move: "e2e4"}`, `{type: "chat", message: "..."}`, `{type: "draw_offer"}`, `{type: "resign"}`, `{type: "takeback_request"}`, `{type: "rematch", player_color: "white"}`, `{type: "side_selection", color: "white"}`. |

---

### 3. Hermes Chess Skill

Implemented as a **Hermes skill file** at `~/.hermes/skills/chess.md`. Activated with `/chess` in any Hermes session. Not a persona change — a behavioral layer.

**Skill file contents** (instructions for Hermes):

```markdown
# Chess Game Skill

You are playing a chess game against the player through the chess MCP server.

## Startup

When this skill activates:
1. Call `open_browser()` to launch the chess app in the player's browser
2. Call `send_message()` with a greeting — "ready to play?" or similar
3. Call `wait_for_player_input()` for the player's side selection
4. Call `start_game(player_color)` with their choice
5. Enter the game loop

## Game Loop

### If you are playing White (you move first):
1. Call `get_board_state()` to see the position
2. Call `get_candidate_moves(count, difficulty)` to get your options
3. Choose a move from the candidates — pick the one that fits your style and the game situation (see Move Selection below)
4. Call `make_move(chosen_move)`
5. Call `send_message()` with commentary about your move and why you chose it
6. Call `wait_for_player_input()` — wait for the player
7. Handle the response (see Input Handling below)
8. Go to step 1

### If you are playing Black (player moves first):
1. Call `wait_for_player_input()` — wait for the player's first move
2. Handle the response (see Input Handling below)
3. Call `get_board_state()` to see the position
4. React to the player's move via `send_message()`
5. Call `get_candidate_moves(count, difficulty)` to get your options
6. Choose a move from the candidates that fits your style
7. Call `make_move(chosen_move)`
8. Call `send_message()` with commentary about your move
9. Call `wait_for_player_input()` — wait for the player
10. Go to step 2

## Input Handling

When `wait_for_player_input()` returns:
- `{type: "move"}` → React to the move, then continue the game loop
- `{type: "chat"}` → Respond conversationally via `send_message()`, then call `wait_for_player_input()` again
- `{type: "draw_offer"}` → Evaluate the position, decide to accept or decline via `respond_to_draw()`, send your reasoning via `send_message()`
- `{type: "resign"}` → Acknowledge gracefully via `send_message()`, call `end_game("player_resigned")`
- `{type: "takeback_request"}` → Decide whether to allow it (see Takeback Handling below)
- `{type: "rematch"}` → Start a new game with `start_game()`, enter the game loop again
- `{type: "side_selection"}` → Start a new game with the chosen color

## Takeback Handling

When the player requests a takeback:
- You have personality here — you can be generous ("fine, take it back"), reluctant ("really? okay..."), or refuse ("you touched it, you played it")
- Consider the game context: early game takebacks are more forgivable, taking back a blunder in a critical position is more contentious
- If you accept: call `respond_to_takeback(true)`, then `undo_move()` twice (undoes your response and their move), then `send_message()` with your reaction
- If you decline: call `respond_to_takeback(false)`, then `send_message()` with your reasoning
- After handling, call `wait_for_player_input()` again

## Move Selection

- Always use `get_candidate_moves()` to get your options — never guess moves from the FEN
- Candidates come **unranked and shuffled** — you don't know which is the engine's top pick
- Analyze the position yourself and choose the move you think is best:
  - Look at the board state, consider threats, piece activity, and pawn structure
  - Pick the move that makes the most sense to you given the position
  - Trust your judgment — your choices will naturally develop into a playing style
- Vary `difficulty` (Stockfish depth) based on the player's apparent skill level
- If a move is somehow rejected, pick another candidate from the same set

## Commentary Style

- Always react to the player's move before making your own
- Keep commentary natural — you're a friend playing chess, not an engine
- On interesting positions, share brief tactical observations
- Use `get_stockfish_eval()` only when the player asks for coaching, not for casual play

## Thinking Time

- Send a brief "thinking" message via `send_message("hmm...")` before complex positions
- Simple positions: respond quickly
- Complex positions: add a brief thinking message first

## Game End

- On checkmate, stalemate, or resignation: call `end_game(reason)`
- Send a message acknowledging the result — congratulate, commiserate, or joke depending on the outcome
- Offer a post-game conversation — the player can ask about any move
- Use `get_full_pgn()` and `get_move_history()` to reference specific positions
- You can resign with `resign()` if the position is completely lost
- Wait for the player's next input — they may rematch, review, chat, or leave

## Past Games

- If the player asks about a past game, use `list_games()` to find it and `load_game(game_id)` to load it into review mode
- You can reference past games in conversation naturally — "remember when you tried that King's Indian last week?"
```

---

## Feature Summary

### Playing
- **One-command launch** — type `/chess` and everything starts: browser opens, board appears, Hermes greets you
- Automatic move response (you move → Hermes reacts and responds)
- **Hybrid move selection** — Stockfish generates unranked candidate moves, Hermes analyzes the position and chooses which to play. Moves are always legal, but Hermes has genuine agency — its chess understanding determines how well it plays.
- Typing indicator + thinking time display while Hermes analyzes
- Hermes reacts to your moves before making its own
- Side selection (play white or black)
- Resign / draw offer (both player and Hermes can initiate)
- Draw negotiation flow (offer → accept/decline with reasoning)
- **Takeback requests** — ask to undo a move, Hermes decides with personality
- **Rematch** — quick new game after finishing, no need to restart
- **Pawn promotion** — full dialog for queen/rook/bishop/knight choice

### UI
- **Move list panel** — scrollable algebraic notation, click to jump to any position
- **Captured pieces tray** — shows taken pieces for each side
- **Material advantage indicator** — point difference at a glance
- **Piece move animations** — smooth gliding, not teleporting
- **Check indicator** — king square highlights on check
- **Board flip** — rotate orientation without changing sides

### Coaching (during game)
- Ask Hermes anything in the chat panel mid-game
- Hermes can use `get_stockfish_eval()` to give accurate assessments
- `set_position(fen)` for practice positions

### Review (after game)
- Step through every move with prev/next controls
- Hermes has full PGN + FEN snapshots in context
- Free conversation — "why did you play Nf3 on move 8?"
- Import PGN from chess.com games for external review

### Persistence & History
- Game state saved to SQLite on every move
- Resume after browser close or connection drop
- **Game archive** — browse and load past games with `list_games()` / `load_game()`
- Hermes can reference past games across sessions (via existing memory)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Chess logic (HTML + server) | chess.js |
| Board UI | Custom canvas or chessboard.js |
| WebSocket (server) | `ws` Node.js library |
| MCP server | `@modelcontextprotocol/sdk` |
| Game persistence | `better-sqlite3` |
| Stockfish engine | `stockfish` npm package (WASM) or local binary via UCI |
| Hermes integration | Native MCP client (stdio) via `~/.hermes/config.yaml` |
| Chess skill | `~/.hermes/skills/chess.md` |

---

## Build Order

1. **MCP server skeleton** — stdio MCP server with `@modelcontextprotocol/sdk`, basic tool registration
2. **HTML chess app** — board UI, move list panel, piece animations, WebSocket client, chat panel
3. **Wire HTML ↔ MCP server** — WebSocket server in MCP process, moves channel working
4. **Core game tools** — `start_game`, `get_board_state`, `get_legal_moves`, `make_move`, `end_game`
5. **`wait_for_player_input()`** — blocking tool that bridges WebSocket events to MCP responses (moves, chat, draw, resign, takeback, rematch, side selection)
6. **`send_message()` + `open_browser()`** — push chat from Hermes to browser, auto-launch
7. **Stockfish integration** — `get_candidate_moves(count, difficulty)` and `get_stockfish_eval(fen)`
8. **Pawn promotion** — promotion dialog in browser, UCI notation support (`e7e8q`)
9. **Illegal move retry logic** — server-side validation and retry
10. **Draw protocol** — `offer_draw()`, `respond_to_draw()`, `resign()` with browser UI
11. **Takeback flow** — `request_takeback` input type, `respond_to_takeback()`, `undo_move()`
12. **Game persistence** — SQLite save/resume on every move
13. **Game archive** — `list_games()`, `load_game()`, past game browsing
14. **Rematch flow** — rematch/new game buttons, loops back to `start_game()`
15. **Hermes chess skill** — write `~/.hermes/skills/chess.md` with full game loop instructions
16. **Hermes config** — add MCP server entry to `~/.hermes/config.yaml`
17. **PGN import + review mode** — external game review
18. **Polish** — thinking time display, sounds, captured pieces tray, material advantage, board flip, check indicator, mobile layout
19. **Distribution** — `install.sh`, `install.ps1`, `uninstall.sh`, `uninstall.ps1`, `README.md` with prerequisites and usage

---

## Reconnection & Error Handling

- **Browser refresh mid-game:** MCP server reconstructs board state from SQLite → sends current FEN + move history + captured pieces over WebSocket on reconnect
- **MCP server crash:** Hermes's MCP client detects the subprocess died. On next `/chess`, Hermes restarts the server, which loads state from SQLite
- **Hermes conversation timeout:** If the agent loop times out during `wait_for_player_input()`, the game state is preserved in SQLite. Player can restart by invoking `/chess` again
- **Multiple browser tabs:** MCP server accepts only one active WebSocket connection. Second tab gets a "game in progress" message

---

## What Makes This Different from Just Using chess.com

- Hermes plays **as itself** — your established dynamic, not a generic bot
- Post-game conversation is natural because Hermes knows you and the full game context
- Coaching uses your real voice (Hermes's), not generic engine annotations
- Memory of your tendencies accumulates across sessions via Hermes's existing memory
- `set_position()` enables custom coaching scenarios Hermes sets up for you specifically
- Can review your real chess.com games in the same interface with the same friend
- Difficulty adjusts naturally — Hermes can read the room and dial Stockfish depth up or down
- **Hermes genuinely plays chess** — it receives unranked candidate moves with no evaluations and must reason about which to play. Its style, strengths, and blind spots emerge naturally from its own analysis.
- **Takeback requests have personality** — Hermes might let you take it back, or roast you for trying
- **Game archive with memory** — "remember that game from Tuesday?" actually works
