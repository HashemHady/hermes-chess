import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * SQLite persistence layer for game state and game archive.
 */
export class GameDB {
  constructor(dbPath) {
    const dir = dirname(dbPath || join(__dirname, '..', 'data', 'chess.db'));
    mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath || join(__dirname, '..', 'data', 'chess.db'));
    this._init();
  }

  /**
   * Initialize database tables.
   */
  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        player_color TEXT NOT NULL,
        hermes_color TEXT NOT NULL,
        result TEXT,
        reason TEXT,
        pgn TEXT,
        fen TEXT NOT NULL,
        move_count INTEGER DEFAULT 0,
        start_time TEXT NOT NULL,
        end_time TEXT,
        active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS moves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        move_number INTEGER NOT NULL,
        uci TEXT NOT NULL,
        san TEXT NOT NULL,
        fen TEXT NOT NULL,
        color TEXT NOT NULL,
        captured TEXT,
        promotion TEXT,
        is_check INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (game_id) REFERENCES games(id)
      );

      CREATE INDEX IF NOT EXISTS idx_moves_game ON moves(game_id);
    `);
  }

  /**
   * Save a new game to the database.
   */
  saveGame(gameState) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO games (id, player_color, hermes_color, result, reason, pgn, fen, move_count, start_time, end_time, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      gameState.gameId,
      gameState.playerColor,
      gameState.hermesColor,
      gameState.gameResult?.result || null,
      gameState.gameResult?.reason || null,
      gameState.pgn,
      gameState.fen,
      gameState.moveHistory.length,
      gameState.startTime,
      gameState.gameActive ? null : new Date().toISOString(),
      gameState.gameActive ? 1 : 0,
    );
  }

  /**
   * Save a move to the database.
   */
  saveMove(gameId, moveEntry, moveNumber) {
    const stmt = this.db.prepare(`
      INSERT INTO moves (game_id, move_number, uci, san, fen, color, captured, promotion, is_check, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      gameId,
      moveNumber,
      moveEntry.move,
      moveEntry.san,
      moveEntry.fen,
      moveEntry.color,
      moveEntry.captured || null,
      moveEntry.promotion || null,
      moveEntry.isCheck ? 1 : 0,
      moveEntry.timestamp,
    );
  }

  /**
   * Delete moves after a certain move number (for takebacks).
   */
  deleteMovesAfter(gameId, moveNumber) {
    const stmt = this.db.prepare('DELETE FROM moves WHERE game_id = ? AND move_number > ?');
    stmt.run(gameId, moveNumber);
  }

  /**
   * Update game state (FEN, PGN, move count, result).
   */
  updateGame(gameId, updates) {
    const fields = [];
    const values = [];

    if (updates.fen !== undefined) { fields.push('fen = ?'); values.push(updates.fen); }
    if (updates.pgn !== undefined) { fields.push('pgn = ?'); values.push(updates.pgn); }
    if (updates.moveCount !== undefined) { fields.push('move_count = ?'); values.push(updates.moveCount); }
    if (updates.result !== undefined) { fields.push('result = ?'); values.push(updates.result); }
    if (updates.reason !== undefined) { fields.push('reason = ?'); values.push(updates.reason); }
    if (updates.active !== undefined) {
      fields.push('active = ?');
      values.push(updates.active ? 1 : 0);
      if (!updates.active) {
        fields.push('end_time = ?');
        values.push(new Date().toISOString());
      }
    }

    if (fields.length === 0) return;

    values.push(gameId);
    const stmt = this.db.prepare(`UPDATE games SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /**
   * Get the active game (if any).
   */
  getActiveGame() {
    return this.db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY start_time DESC LIMIT 1').get();
  }

  /**
   * Get moves for a game.
   */
  getGameMoves(gameId) {
    return this.db.prepare('SELECT * FROM moves WHERE game_id = ? ORDER BY move_number ASC').all(gameId);
  }

  /**
   * List past games.
   * @param {number} limit
   */
  listGames(limit = 20) {
    return this.db.prepare(
      'SELECT id, player_color, hermes_color, result, reason, move_count, start_time, end_time FROM games ORDER BY start_time DESC LIMIT ?'
    ).all(limit);
  }

  /**
   * Get a specific game by ID.
   */
  getGame(gameId) {
    return this.db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  }

  /**
   * Close the database connection.
   */
  close() {
    this.db.close();
  }
}
