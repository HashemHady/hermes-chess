import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { exec } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { GameEngine } from './game.js';
import { StockfishEngine } from './stockfish.js';
import { GameDB } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_PATH = join(__dirname, '..', 'app', 'index.html');
const WS_PORT = 3377;

// --- Core State ---
const game = new GameEngine();
const db = new GameDB();
let stockfish = null;
let wsClient = null;            // Active browser WebSocket connection
let pendingInput = null;        // { resolve } — blocked wait_for_player_input
let hermesThinkingStart = null; // Track thinking time

// --- Zod doesn't ship with MCP SDK, use inline validation ---
// The MCP SDK v1.12+ uses zod for schema, let's define our schemas

// --- WebSocket Server ---
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws) => {
  if (wsClient && wsClient.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress in another tab' }));
    ws.close();
    return;
  }

  wsClient = ws;
  console.error(`[WS] Browser connected on port ${WS_PORT}`);

  // If there's an active game, send current state
  if (game.gameActive) {
    ws.send(JSON.stringify({ type: 'game_state', data: game.serialize() }));
  } else {
    // Check for a resumable game in SQLite
    const activeGame = db.getActiveGame();
    if (activeGame) {
      ws.send(JSON.stringify({ type: 'resume_available', data: activeGame }));
    } else {
      ws.send(JSON.stringify({ type: 'waiting', message: 'Connected. Waiting for Hermes to start a game.' }));
    }
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleBrowserMessage(msg);
    } catch (e) {
      console.error('[WS] Invalid message:', e.message);
    }
  });

  ws.on('close', () => {
    console.error('[WS] Browser disconnected');
    if (wsClient === ws) wsClient = null;
  });
});

/**
 * Handle messages from the browser.
 */
function handleBrowserMessage(msg) {
  // Resolve any pending wait_for_player_input
  if (pendingInput) {
    const resolve = pendingInput.resolve;
    pendingInput = null;

    switch (msg.type) {
      case 'move':
        // Player made a move — validate and apply
        const result = game.makeMove(msg.move);
        if (result.success) {
          // Persist
          db.saveMove(game.gameId, result.move, game.moveHistory.length);
          db.updateGame(game.gameId, {
            fen: game.chess.fen(),
            pgn: game.getPgn(),
            moveCount: game.moveHistory.length,
          });
          // Notify browser of the applied move
          sendToBrowser({ type: 'move_applied', data: result });
          // Check auto-end
          if (result.gameOver) {
            db.updateGame(game.gameId, {
              result: result.gameOver.result,
              reason: result.gameOver.reason,
              active: false,
            });
            sendToBrowser({ type: 'game_over', data: result.gameOver });
          }
          resolve({ type: 'move', move: msg.move, san: result.san, gameOver: result.gameOver || null });
        } else {
          // Illegal move from browser — shouldn't happen (browser validates too)
          sendToBrowser({ type: 'illegal_move', error: result.error });
          // Re-wait for input
          pendingInput = { resolve };
        }
        break;

      case 'chat':
        resolve({ type: 'chat', message: msg.message });
        break;

      case 'draw_offer':
        sendToBrowser({ type: 'draw_offered_by_player' });
        resolve({ type: 'draw_offer' });
        break;

      case 'resign':
        resolve({ type: 'resign' });
        break;

      case 'takeback_request':
        resolve({ type: 'takeback_request' });
        break;

      case 'rematch':
        resolve({ type: 'rematch', player_color: msg.player_color || game.playerColor });
        break;

      case 'side_selection':
        resolve({ type: 'side_selection', color: msg.color });
        break;

      case 'resume_game':
        const activeGame = db.getActiveGame();
        if (activeGame) {
          game.gameId = activeGame.id;
          game.playerColor = activeGame.playerColor;
          game.hermesColor = activeGame.hermesColor;
          game.importPgn(activeGame.pgn);
          game.gameActive = true;
          sendToBrowser({ type: 'game_loaded', data: game.serialize() });
          resolve({ type: 'game_resumed', playerColor: game.playerColor, fen: game.chess.fen() });
        } else {
          sendToBrowser({ type: 'hermes_waiting' });
          pendingInput = { resolve };
        }
        break;

      case 'abandon_game':
        db.db.prepare('UPDATE games SET active = 0 WHERE active = 1').run();
        sendToBrowser({ type: 'hermes_waiting' });
        pendingInput = { resolve };
        break;

      default:
        // Unknown type — re-wait
        pendingInput = { resolve };
    }
  }
}

/**
 * Send a message to the browser via WebSocket.
 */
function sendToBrowser(msg) {
  if (wsClient && wsClient.readyState === wsClient.OPEN) {
    wsClient.send(JSON.stringify(msg));
  }
}

// --- Initialize Stockfish ---
async function initStockfish() {
  try {
    stockfish = new StockfishEngine();
    await stockfish.init();
    console.error('[Stockfish] Initialized');
  } catch (e) {
    console.error(`[Stockfish] Warning: ${e.message}`);
    console.error('[Stockfish] Candidate moves will not be available.');
    stockfish = null;
  }
}

// --- MCP Server ---
const server = new McpServer({
  name: 'hermes-chess',
  version: '1.0.0',
});

// ============================================================
// GAME MANAGEMENT TOOLS
// ============================================================

server.tool(
  'start_game',
  'Initialize a new chess game. Sets sides and prepares the board.',
  { player_color: z.enum(['white', 'black']).describe('The color the player will play as') },
  async ({ player_color }) => {
    const result = game.startGame(player_color);
    db.saveGame(game.serialize());
    sendToBrowser({ type: 'game_started', data: result });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'end_game',
  'End the current game with a reason (checkmate, resign, draw, etc.)',
  { reason: z.string().describe('Reason for ending: checkmate, resign, player_resigned, draw_agreed, stalemate') },
  async ({ reason }) => {
    const result = game.endGame(reason);
    db.updateGame(game.gameId, { result: result.result, reason: result.reason, active: false });
    sendToBrowser({ type: 'game_over', data: result });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'resign',
  'Hermes resigns the current game.',
  {},
  async () => {
    const result = game.endGame('resign');
    db.updateGame(game.gameId, { result: result.result, reason: result.reason, active: false });
    sendToBrowser({ type: 'game_over', data: { ...result, resignedBy: 'hermes' } });
    return { content: [{ type: 'text', text: `Resigned. Result: ${result.result}` }] };
  }
);

server.tool(
  'offer_draw',
  'Hermes offers a draw to the player.',
  {},
  async () => {
    game.drawOffer = 'hermes';
    sendToBrowser({ type: 'draw_offered_by_hermes' });
    return { content: [{ type: 'text', text: 'Draw offer sent to player. Wait for their response via wait_for_player_input().' }] };
  }
);

server.tool(
  'respond_to_draw',
  'Hermes accepts or declines a draw offer from the player.',
  { accept: z.boolean().describe('true to accept the draw, false to decline') },
  async ({ accept }) => {
    if (accept) {
      const result = game.endGame('draw_agreed');
      db.updateGame(game.gameId, { result: result.result, reason: result.reason, active: false });
      sendToBrowser({ type: 'draw_accepted' });
      return { content: [{ type: 'text', text: 'Draw accepted. Game over: 1/2-1/2' }] };
    } else {
      game.drawOffer = null;
      sendToBrowser({ type: 'draw_declined' });
      return { content: [{ type: 'text', text: 'Draw declined. Game continues.' }] };
    }
  }
);

server.tool(
  'respond_to_takeback',
  'Hermes accepts or declines a takeback request from the player.',
  { accept: z.boolean().describe('true to allow the takeback, false to decline') },
  async ({ accept }) => {
    if (accept) {
      sendToBrowser({ type: 'takeback_accepted' });
      return { content: [{ type: 'text', text: 'Takeback accepted. Use undo_move() to revert moves.' }] };
    } else {
      sendToBrowser({ type: 'takeback_declined' });
      return { content: [{ type: 'text', text: 'Takeback declined. Game continues.' }] };
    }
  }
);

server.tool(
  'open_browser',
  'Opens the chess app in the default browser.',
  {},
  async () => {
    const url = `file://${APP_PATH}`;
    const platform = process.platform;
    let cmd;

    if (platform === 'darwin') cmd = `open "${url}"`;
    else if (platform === 'win32') cmd = `start "${url}"`;
    else cmd = `xdg-open "${url}"`;

    return new Promise((resolve) => {
      exec(cmd, (err) => {
        if (err) {
          resolve({ content: [{ type: 'text', text: `Failed to open browser: ${err.message}. Open manually: ${url}` }] });
        } else {
          resolve({ content: [{ type: 'text', text: `Browser opened. Waiting for connection on port ${WS_PORT}...` }] });
        }
      });
    });
  }
);

// ============================================================
// BOARD & MOVES TOOLS
// ============================================================

server.tool(
  'get_board_state',
  'Get the current board position as a FEN string with game status.',
  {},
  async () => {
    const state = game.getBoardState();
    const captured = game.getCapturedPieces();
    return { content: [{ type: 'text', text: JSON.stringify({ ...state, captured }, null, 2) }] };
  }
);

server.tool(
  'get_legal_moves',
  'Get all legal moves in the current position.',
  {},
  async () => {
    const moves = game.getLegalMoves();
    return { content: [{ type: 'text', text: JSON.stringify(moves, null, 2) }] };
  }
);

server.tool(
  'make_move',
  'Execute a move in UCI notation (e.g., e2e4, e7e8q for promotion). The move is validated before being applied.',
  { move: z.string().describe('Move in UCI notation (e.g., e2e4, e7e8q for queen promotion)') },
  async ({ move }) => {
    hermesThinkingStart = null;
    const result = game.makeMove(move);

    if (result.success) {
      db.saveMove(game.gameId, result.move, game.moveHistory.length);
      db.updateGame(game.gameId, {
        fen: game.chess.fen(),
        pgn: game.getPgn(),
        moveCount: game.moveHistory.length,
      });
      sendToBrowser({ type: 'hermes_move', data: result });

      if (result.gameOver) {
        db.updateGame(game.gameId, {
          result: result.gameOver.result,
          reason: result.gameOver.reason,
          active: false,
        });
        sendToBrowser({ type: 'game_over', data: result.gameOver });
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } else {
      return { content: [{ type: 'text', text: `Move failed: ${result.error}` }], isError: true };
    }
  }
);

server.tool(
  'undo_move',
  'Undo the last move. Used when Hermes approves a takeback.',
  {},
  async () => {
    const result = game.undoMove();
    if (result.success) {
      db.deleteMovesAfter(game.gameId, game.moveHistory.length);
      db.updateGame(game.gameId, {
        fen: result.fen,
        pgn: game.getPgn(),
        moveCount: game.moveHistory.length,
      });
      sendToBrowser({ type: 'move_undone', data: result });
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_move_history',
  'Get the full move list with FEN snapshots for each move.',
  {},
  async () => {
    const history = game.getMoveHistory();
    return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
  }
);

server.tool(
  'get_full_pgn',
  'Get the complete game in PGN format.',
  {},
  async () => {
    const pgn = game.getPgn();
    return { content: [{ type: 'text', text: pgn || 'No moves yet.' }] };
  }
);

server.tool(
  'set_position',
  'Set the board to a specific position using a FEN string. Useful for coaching and puzzles.',
  { fen: z.string().describe('FEN string for the position') },
  async ({ fen }) => {
    const result = game.setPosition(fen);
    if (result.success) sendToBrowser({ type: 'position_set', fen: result.fen });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'import_pgn',
  'Load an external game from PGN for review.',
  { pgn: z.string().describe('PGN string of the game to import') },
  async ({ pgn }) => {
    const result = game.importPgn(pgn);
    if (result.success) {
      sendToBrowser({ type: 'pgn_imported', data: game.serialize() });
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ============================================================
// ENGINE ASSISTANCE TOOLS
// ============================================================

server.tool(
  'get_candidate_moves',
  'Get candidate moves from Stockfish, shuffled with no ranking or evaluation. Hermes must analyze the position and choose.',
  {
    count: z.number().optional().default(4).describe('Number of candidates to return (default 4)'),
    difficulty: z.number().optional().default(10).describe('Stockfish search depth (1-20, default 10)'),
  },
  async ({ count, difficulty }) => {
    if (!stockfish) {
      // Fallback: return random legal moves
      const legal = game.getLegalMoves();
      const shuffled = legal.sort(() => Math.random() - 0.5).slice(0, count);
      const candidates = shuffled.map(m => ({
        uci: m.uci,
        description: `${m.piece === 'p' ? 'Pawn' : m.piece === 'n' ? 'Knight' : m.piece === 'b' ? 'Bishop' : m.piece === 'r' ? 'Rook' : m.piece === 'q' ? 'Queen' : 'King'} to ${m.to}${m.captured ? ', capturing' : ''}`,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(candidates, null, 2) }] };
    }

    const fen = game.chess.fen();
    const legalMoves = game.getLegalMoves();
    const candidates = await stockfish.getCandidateMoves(fen, count, difficulty, legalMoves);
    return { content: [{ type: 'text', text: JSON.stringify(candidates, null, 2) }] };
  }
);

server.tool(
  'get_stockfish_eval',
  'Get Stockfish evaluation of a position. For coaching only — not for move selection.',
  { fen: z.string().optional().describe('FEN to evaluate. Defaults to current position.') },
  async ({ fen }) => {
    if (!stockfish) {
      return { content: [{ type: 'text', text: 'Stockfish not available.' }], isError: true };
    }
    const position = fen || game.chess.fen();
    const evaluation = await stockfish.getEval(position);
    return { content: [{ type: 'text', text: JSON.stringify(evaluation, null, 2) }] };
  }
);

// ============================================================
// GAME ARCHIVE TOOLS
// ============================================================

server.tool(
  'list_games',
  'List past games with date, result, player color, and move count.',
  { limit: z.number().optional().default(20).describe('Maximum number of games to return') },
  async ({ limit }) => {
    const games = db.listGames(limit);
    return { content: [{ type: 'text', text: JSON.stringify(games, null, 2) }] };
  }
);

server.tool(
  'load_game',
  'Load a past game into review mode.',
  { game_id: z.string().describe('The game ID to load') },
  async ({ game_id }) => {
    const savedGame = db.getGame(game_id);
    if (!savedGame) {
      return { content: [{ type: 'text', text: `Game not found: ${game_id}` }], isError: true };
    }

    // Load the PGN into the engine
    if (savedGame.pgn) {
      game.importPgn(savedGame.pgn);
    }
    game.playerColor = savedGame.player_color;
    game.hermesColor = savedGame.hermes_color;
    game.gameId = savedGame.id;
    game.gameActive = false;
    game.gameResult = savedGame.result ? { result: savedGame.result, reason: savedGame.reason } : null;

    sendToBrowser({ type: 'game_loaded', data: game.serialize() });
    return { content: [{ type: 'text', text: JSON.stringify({ loaded: true, gameId: game_id, moveCount: savedGame.move_count, result: savedGame.result }, null, 2) }] };
  }
);

// ============================================================
// COMMUNICATION TOOLS
// ============================================================

server.tool(
  'send_message',
  'Send a chat message to the player. Appears in the browser chat panel.',
  { text: z.string().describe('The message text to send') },
  async ({ text }) => {
    sendToBrowser({ type: 'hermes_message', text });
    return { content: [{ type: 'text', text: `Message sent: "${text}"` }] };
  }
);

server.tool(
  'wait_for_player_input',
  'Block and wait for the player to act (move, chat, draw offer, resign, takeback request, rematch, or side selection). Returns the player\'s input when they act.',
  {},
  async () => {
    hermesThinkingStart = null;
    sendToBrowser({ type: 'hermes_waiting' });

    return new Promise((resolve) => {
      pendingInput = {
        resolve: (input) => {
          resolve({ content: [{ type: 'text', text: JSON.stringify(input, null, 2) }] });
          hermesThinkingStart = Date.now();
          sendToBrowser({ type: 'hermes_thinking' });
        },
      };
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

async function main() {
  console.error('[Chess MCP] Starting server...');
  console.error(`[Chess MCP] WebSocket server on port ${WS_PORT}`);
  console.error(`[Chess MCP] HTML app: ${APP_PATH}`);

  // Initialize Stockfish (non-blocking — server starts even if Stockfish fails)
  initStockfish();

  // Connect MCP via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Chess MCP] MCP server connected via stdio');
}

main().catch((err) => {
  console.error('[Chess MCP] Fatal error:', err);
  process.exit(1);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.error('[Chess MCP] Shutting down...');
  if (stockfish) stockfish.destroy();
  db.close();
  wss.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (stockfish) stockfish.destroy();
  db.close();
  wss.close();
  process.exit(0);
});
