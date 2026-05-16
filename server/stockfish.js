import { spawn } from 'child_process';

/**
 * Stockfish UCI interface.
 * Spawns a Stockfish process and communicates via UCI protocol.
 */
export class StockfishEngine {
  constructor() {
    this.process = null;
    this.ready = false;
    this.pending = null; // { resolve, reject, lines }
  }

  /**
   * Initialize Stockfish process.
   */
  async init() {
    return new Promise((resolve, reject) => {
      try {
        // Try common Stockfish binary locations
        this.process = spawn('stockfish', [], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        reject(new Error(
          'Stockfish not found. Install it:\n' +
          '  macOS: brew install stockfish\n' +
          '  Linux: sudo apt install stockfish\n' +
          '  Windows: download from https://stockfishchess.org/download/'
        ));
        return;
      }

      this.process.on('error', (err) => {
        reject(new Error(
          `Failed to start Stockfish: ${err.message}\n` +
          'Install it:\n' +
          '  macOS: brew install stockfish\n' +
          '  Linux: sudo apt install stockfish\n' +
          '  Windows: download from https://stockfishchess.org/download/'
        ));
      });

      let initOutput = '';
      const onData = (data) => {
        initOutput += data.toString();
        if (initOutput.includes('uciok')) {
          this.process.stdout.removeListener('data', onData);
          this.ready = true;
          this._setupListener();
          // Set default options
          this._send('isready');
          this._waitFor('readyok').then(() => resolve());
        }
      };

      this.process.stdout.on('data', onData);
      this._send('uci');
    });
  }

  /**
   * Send a command to Stockfish.
   */
  _send(cmd) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(cmd + '\n');
    }
  }

  /**
   * Set up persistent stdout listener.
   */
  _setupListener() {
    this.process.stdout.on('data', (data) => {
      if (this.pending) {
        this.pending.lines.push(data.toString());
        const full = this.pending.lines.join('');
        if (full.includes(this.pending.waitFor)) {
          const resolve = this.pending.resolve;
          const lines = full;
          this.pending = null;
          resolve(lines);
        }
      }
    });
  }

  /**
   * Wait for a specific string in Stockfish output.
   */
  _waitFor(target) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = null;
        reject(new Error(`Stockfish timeout waiting for: ${target}`));
      }, 30000);

      this.pending = {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject,
        lines: [],
        waitFor: target,
      };
    });
  }

  /**
   * Get candidate moves for a position.
   * Returns shuffled moves with no evaluation — just UCI + description.
   *
   * @param {string} fen - Current position
   * @param {number} count - Number of candidates to return (default 4)
   * @param {number} difficulty - Stockfish depth (default 10)
   * @param {Array} legalMoves - Legal moves from chess.js for descriptions
   * @returns {Array<{ uci: string, description: string }>}
   */
  async getCandidateMoves(fen, count = 4, difficulty = 10, legalMoves = []) {
    if (!this.ready) throw new Error('Stockfish not initialized');

    // Set MultiPV to get multiple lines
    const multiPv = Math.min(count + 2, 10); // request a few extra
    this._send(`setoption name MultiPV value ${multiPv}`);
    this._send('isready');
    await this._waitFor('readyok');

    // Set position and search
    this._send(`position fen ${fen}`);
    this._send(`go depth ${difficulty}`);

    const output = await this._waitFor('bestmove');

    // Parse PV lines to extract moves
    const pvMoves = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const depthMatch = line.match(/info depth (\d+)/);
      const pvMatch = line.match(/multipv (\d+)/);
      const moveMatch = line.match(/ pv (\S+)/);

      if (depthMatch && pvMatch && moveMatch) {
        const depth = parseInt(depthMatch[1]);
        if (depth === difficulty) {
          pvMoves.push({
            pv: parseInt(pvMatch[1]),
            uci: moveMatch[1],
          });
        }
      }
    }

    // Deduplicate by PV number (keep last/deepest entry per PV)
    const pvMap = new Map();
    for (const m of pvMoves) {
      pvMap.set(m.pv, m.uci);
    }

    // Get unique moves
    let candidates = [...pvMap.values()].slice(0, count);

    // If we didn't get enough from MultiPV, extract from bestmove
    if (candidates.length === 0) {
      const bestMatch = output.match(/bestmove (\S+)/);
      if (bestMatch) candidates = [bestMatch[1]];
    }

    // Build descriptions from legal moves
    const moveDescriptions = this._buildDescriptions(candidates, legalMoves);

    // Shuffle — no ranking exposed
    return this._shuffle(moveDescriptions);
  }

  /**
   * Get Stockfish evaluation for a position.
   * @param {string} fen
   * @param {number} depth
   * @returns {{ eval: number, bestMove: string, bestLine: string }}
   */
  async getEval(fen, depth = 18) {
    if (!this.ready) throw new Error('Stockfish not initialized');

    this._send('setoption name MultiPV value 1');
    this._send('isready');
    await this._waitFor('readyok');

    this._send(`position fen ${fen}`);
    this._send(`go depth ${depth}`);

    const output = await this._waitFor('bestmove');

    // Parse evaluation
    let evalCp = 0;
    let bestLine = '';
    let isMate = false;
    let mateIn = 0;

    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes(`info depth ${depth}`) && line.includes(' pv ')) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        const pvMatch = line.match(/ pv (.+)/);

        if (cpMatch) evalCp = parseInt(cpMatch[1]);
        if (mateMatch) { isMate = true; mateIn = parseInt(mateMatch[1]); }
        if (pvMatch) bestLine = pvMatch[1].trim();
      }
    }

    const bestMatch = output.match(/bestmove (\S+)/);

    return {
      eval: isMate ? (mateIn > 0 ? 10000 : -10000) : evalCp / 100,
      evalCp,
      isMate,
      mateIn,
      bestMove: bestMatch ? bestMatch[1] : null,
      bestLine,
    };
  }

  /**
   * Build human-readable descriptions for moves.
   */
  _buildDescriptions(uciMoves, legalMoves) {
    const pieceNames = {
      p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King',
    };

    return uciMoves.map(uci => {
      const legal = legalMoves.find(m => (m.from + m.to + (m.promotion || '')) === uci);
      if (!legal) {
        return { uci, description: `Move ${uci}` };
      }

      const piece = pieceNames[legal.piece] || 'Piece';
      const capture = legal.captured ? `capturing ${pieceNames[legal.captured] || 'piece'}` : '';
      const promotion = legal.promotion ? `, promoting to ${pieceNames[legal.promotion]}` : '';
      const check = legal.san.includes('+') ? ', with check' : '';
      const checkmate = legal.san.includes('#') ? ', checkmate!' : '';

      let desc = `${piece} to ${legal.to}`;
      if (capture) desc += `, ${capture}`;
      if (promotion) desc += promotion;
      if (checkmate) desc += checkmate;
      else if (check) desc += check;

      return { uci, description: desc };
    });
  }

  /**
   * Fisher-Yates shuffle — randomize order so no ranking is exposed.
   */
  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Shut down Stockfish process.
   */
  destroy() {
    if (this.process) {
      this._send('quit');
      this.process.kill();
      this.process = null;
      this.ready = false;
    }
  }
}
