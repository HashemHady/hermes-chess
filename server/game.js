import { Chess } from 'chess.js';

/**
 * Game state manager wrapping chess.js.
 * Maintains authoritative game state, validates moves, tracks history.
 */
export class GameEngine {
  constructor() {
    this.chess = new Chess();
    this.playerColor = null;    // 'white' or 'black'
    this.hermesColor = null;    // 'white' or 'black'
    this.gameActive = false;
    this.moveHistory = [];      // { move, fen, san, timestamp }
    this.gameResult = null;     // { result, reason }
    this.gameId = null;
    this.startTime = null;
    this.drawOffer = null;      // 'player' | 'hermes' | null
  }

  /**
   * Start a new game.
   * @param {string} playerColor - 'white' or 'black'
   * @returns {{ fen: string, playerColor: string, hermesColor: string }}
   */
  startGame(playerColor) {
    this.chess = new Chess();
    this.playerColor = playerColor;
    this.hermesColor = playerColor === 'white' ? 'black' : 'white';
    this.gameActive = true;
    this.moveHistory = [];
    this.gameResult = null;
    this.gameId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    this.startTime = new Date().toISOString();
    this.drawOffer = null;

    return {
      fen: this.chess.fen(),
      playerColor: this.playerColor,
      hermesColor: this.hermesColor,
      gameId: this.gameId,
    };
  }

  /**
   * Get current board state.
   */
  getBoardState() {
    const turn = this.chess.turn() === 'w' ? 'white' : 'black';
    return {
      fen: this.chess.fen(),
      turn,
      isCheck: this.chess.isCheck(),
      isCheckmate: this.chess.isCheckmate(),
      isStalemate: this.chess.isStalemate(),
      isDraw: this.chess.isDraw(),
      isGameOver: this.chess.isGameOver(),
      moveNumber: Math.ceil(this.chess.moveNumber()),
      playerColor: this.playerColor,
      hermesColor: this.hermesColor,
    };
  }

  /**
   * Get all legal moves in current position.
   */
  getLegalMoves() {
    const moves = this.chess.moves({ verbose: true });
    return moves.map(m => ({
      uci: m.from + m.to + (m.promotion || ''),
      san: m.san,
      from: m.from,
      to: m.to,
      piece: m.piece,
      captured: m.captured || null,
      promotion: m.promotion || null,
      flags: m.flags,
    }));
  }

  /**
   * Make a move. Validates via chess.js.
   * @param {string} moveUci - UCI notation (e.g., 'e2e4', 'e7e8q')
   * @returns {{ success: boolean, san?: string, fen?: string, error?: string, gameOver?: object }}
   */
  makeMove(moveUci) {
    if (!this.gameActive) {
      return { success: false, error: 'No active game' };
    }

    // Parse UCI move
    const from = moveUci.slice(0, 2);
    const to = moveUci.slice(2, 4);
    const promotion = moveUci.length > 4 ? moveUci[4] : undefined;

    try {
      const result = this.chess.move({ from, to, promotion });
      if (!result) {
        return { success: false, error: `Illegal move: ${moveUci}` };
      }

      const entry = {
        move: moveUci,
        san: result.san,
        fen: this.chess.fen(),
        from: result.from,
        to: result.to,
        piece: result.piece,
        captured: result.captured || null,
        promotion: result.promotion || null,
        color: result.color === 'w' ? 'white' : 'black',
        isCheck: this.chess.isCheck(),
        timestamp: Date.now(),
      };
      this.moveHistory.push(entry);

      // Check for game end conditions
      let gameOver = null;
      if (this.chess.isCheckmate()) {
        gameOver = { result: entry.color === 'w' ? '1-0' : '0-1', reason: 'checkmate' };
      } else if (this.chess.isStalemate()) {
        gameOver = { result: '1/2-1/2', reason: 'stalemate' };
      } else if (this.chess.isThreefoldRepetition()) {
        gameOver = { result: '1/2-1/2', reason: 'threefold_repetition' };
      } else if (this.chess.isInsufficientMaterial()) {
        gameOver = { result: '1/2-1/2', reason: 'insufficient_material' };
      } else if (this.chess.isDraw()) {
        // 50-move rule or other draw
        gameOver = { result: '1/2-1/2', reason: 'fifty_move_rule' };
      }

      if (gameOver) {
        this.gameResult = gameOver;
        this.gameActive = false;
      }

      return {
        success: true,
        san: result.san,
        fen: this.chess.fen(),
        move: entry,
        gameOver,
      };
    } catch (e) {
      return { success: false, error: `Invalid move: ${moveUci} — ${e.message}` };
    }
  }

  /**
   * Undo the last move (for takebacks).
   * @returns {{ success: boolean, fen?: string, error?: string }}
   */
  undoMove() {
    const result = this.chess.undo();
    if (!result) {
      return { success: false, error: 'No move to undo' };
    }
    this.moveHistory.pop();
    this.gameActive = true;
    this.gameResult = null;
    return { success: true, fen: this.chess.fen(), undone: result.san };
  }

  /**
   * End the game with a reason.
   * @param {string} reason - 'checkmate', 'resign', 'draw_agreed', 'player_resigned', etc.
   */
  endGame(reason) {
    let result;
    switch (reason) {
      case 'checkmate':
        const winner = this.chess.turn() === 'w' ? '0-1' : '1-0';
        result = { result: winner, reason: 'checkmate' };
        break;
      case 'resign':
        result = { result: this.hermesColor === 'white' ? '0-1' : '1-0', reason: 'hermes_resigned' };
        break;
      case 'player_resigned':
        result = { result: this.playerColor === 'white' ? '0-1' : '1-0', reason: 'player_resigned' };
        break;
      case 'draw_agreed':
        result = { result: '1/2-1/2', reason: 'draw_agreed' };
        break;
      default:
        result = { result: '1/2-1/2', reason };
    }
    this.gameResult = result;
    this.gameActive = false;
    return result;
  }

  /**
   * Get full move history with FEN snapshots.
   */
  getMoveHistory() {
    return this.moveHistory.map((entry, idx) => ({
      moveNumber: Math.floor(idx / 2) + 1,
      side: idx % 2 === 0 ? 'white' : 'black',
      ...entry,
    }));
  }

  /**
   * Get PGN of current game.
   */
  getPgn() {
    return this.chess.pgn({ newline: '\n' });
  }

  /**
   * Set board to a specific position.
   * @param {string} fen
   */
  setPosition(fen) {
    const success = this.chess.load(fen);
    if (!success) {
      return { success: false, error: `Invalid FEN: ${fen}` };
    }
    return { success: true, fen: this.chess.fen() };
  }

  /**
   * Import a PGN string.
   * @param {string} pgn
   */
  importPgn(pgn) {
    try {
      this.chess.loadPgn(pgn);
      // Rebuild move history from the loaded PGN
      const history = this.chess.history({ verbose: true });
      this.moveHistory = history.map((m, idx) => ({
        move: m.from + m.to + (m.promotion || ''),
        san: m.san,
        fen: m.after,
        from: m.from,
        to: m.to,
        piece: m.piece,
        captured: m.captured || null,
        promotion: m.promotion || null,
        color: m.color === 'w' ? 'white' : 'black',
        isCheck: false, // not easily determined from history
        timestamp: Date.now(),
      }));
      return { success: true, fen: this.chess.fen(), moveCount: history.length };
    } catch (e) {
      return { success: false, error: `Invalid PGN: ${e.message}` };
    }
  }

  /**
   * Get captured pieces for each side.
   */
  getCapturedPieces() {
    const initial = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
    const current = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } };

    const board = this.chess.board();
    for (const row of board) {
      for (const sq of row) {
        if (sq) current[sq.color][sq.type]++;
      }
    }

    const capturedByWhite = {}; // black pieces captured by white
    const capturedByBlack = {}; // white pieces captured by black
    for (const piece of Object.keys(initial)) {
      const blackCaptured = initial[piece] - current.b[piece];
      const whiteCaptured = initial[piece] - current.w[piece];
      if (blackCaptured > 0) capturedByWhite[piece] = blackCaptured;
      if (whiteCaptured > 0) capturedByBlack[piece] = whiteCaptured;
    }

    // Material values
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let whiteAdvantage = 0;
    for (const [p, count] of Object.entries(capturedByWhite)) whiteAdvantage += values[p] * count;
    for (const [p, count] of Object.entries(capturedByBlack)) whiteAdvantage -= values[p] * count;

    return {
      capturedByWhite,
      capturedByBlack,
      materialAdvantage: whiteAdvantage,
    };
  }

  /**
   * Serialize full game state for persistence / WebSocket sync.
   */
  serialize() {
    return {
      fen: this.chess.fen(),
      pgn: this.getPgn(),
      playerColor: this.playerColor,
      hermesColor: this.hermesColor,
      gameActive: this.gameActive,
      gameResult: this.gameResult,
      gameId: this.gameId,
      startTime: this.startTime,
      moveHistory: this.moveHistory,
      captured: this.getCapturedPieces(),
      boardState: this.getBoardState(),
    };
  }
}
