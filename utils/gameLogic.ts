import { BoardState, Move, Piece, PlayerColor, Position, MoveResult } from '../types';
import { BOARD_SIZE } from '../constants';

const DIRECTIONS = [
  { r: -1, c: -1 },
  { r: -1, c: 1 },
  { r: 1, c: -1 },
  { r: 1, c: 1 },
];

export const isValidPos = (r: number, c: number) =>
  r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;

export const createInitialBoard = (): BoardState => {
  const board: BoardState = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
  
  // Rows 0-2 are Black (Computer/Player 2)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 !== 0) {
        board[r][c] = { color: 'black', isKing: false };
      }
    }
  }

  // Rows 5-7 are White (Player 1)
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 !== 0) {
        board[r][c] = { color: 'white', isKing: false };
      }
    }
  }
  return board;
};

// --- Move Generation Logic ---

// Helper to get all raw moves for a specific piece, disregarding max-capture rule initially
const getMovesForPiece = (
  board: BoardState,
  pos: Position,
  piece: Piece
): Move[] => {
  const moves: Move[] = [];
  const { row, col } = pos;
  const isWhite = piece.color === 'white';
  
  // Directions based on color for men (Kings use all)
  const forwardDirs = isWhite 
    ? [{ r: -1, c: -1 }, { r: -1, c: 1 }] 
    : [{ r: 1, c: -1 }, { r: 1, c: 1 }];
  
  const moveDirs = piece.isKing ? DIRECTIONS : forwardDirs;

  // 1. NON-CAPTURE MOVES (Only if not forced to capture elsewhere, handled by higher level)
  if (piece.isKing) {
    // Flying King Logic: Slide until blocked
    for (const dir of DIRECTIONS) {
      let r = row + dir.r;
      let c = col + dir.c;
      while (isValidPos(r, c)) {
        if (board[r][c] === null) {
          moves.push({ from: pos, to: { row: r, col: c }, captures: [] });
        } else {
          break; // Blocked
        }
        r += dir.r;
        c += dir.c;
      }
    }
  } else {
    // Regular Men Logic
    for (const dir of moveDirs) {
      const r = row + dir.r;
      const c = col + dir.c;
      if (isValidPos(r, c) && board[r][c] === null) {
        moves.push({ from: pos, to: { row: r, col: c }, captures: [] });
      }
    }
  }

  // 2. CAPTURE MOVES
  if (!piece.isKing) {
    // Men Captures (Forward Diagonal Only)
    for (const dir of forwardDirs) { 
      const midR = row + dir.r;
      const midC = col + dir.c;
      const destR = row + (dir.r * 2);
      const destC = col + (dir.c * 2);

      if (isValidPos(destR, destC)) {
        const midPiece = board[midR][midC];
        const destPiece = board[destR][destC];
        
        if (midPiece && midPiece.color !== piece.color && destPiece === null) {
           moves.push({ 
             from: pos, 
             to: { row: destR, col: destC }, 
             captures: [{ row: midR, col: midC }] 
           });
        }
      }
    }
  } else {
    // Flying King Captures
    for (const dir of DIRECTIONS) {
      let r = row + dir.r;
      let c = col + dir.c;
      let foundEnemy = false;
      let enemyPos: Position | null = null;

      while (isValidPos(r, c)) {
        const cell = board[r][c];
        
        if (cell === null) {
          if (foundEnemy && enemyPos) {
            // Can land here
             moves.push({ 
               from: pos, 
               to: { row: r, col: c }, 
               captures: [enemyPos] 
             });
          }
        } else {
          if (cell.color === piece.color) {
            break; // Blocked by own piece
          } else {
            if (foundEnemy) {
              break; // Blocked by second enemy (cannot jump two in a row without landing)
            }
            foundEnemy = true;
            enemyPos = { row: r, col: c };
          }
        }
        r += dir.r;
        c += dir.c;
      }
    }
  }

  return moves;
};

// Recursive function to find the maximum capture chain for a piece
const getMaxCaptureChain = (
  board: BoardState,
  pos: Position,
  currentChain: Move[] = []
): { moves: Move[], count: number }[] => {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];

  // Get immediate moves from this position
  const moves = getMovesForPiece(board, pos, piece);
  // Filter only captures
  const captureMoves = moves.filter(m => m.captures.length > 0);

  if (captureMoves.length === 0) {
    // Base case: No more captures. 
    // If we have a chain, return it.
    if (currentChain.length > 0) {
      return [{ moves: currentChain, count: currentChain.length }];
    }
    return []; 
  }

  let results: { moves: Move[], count: number }[] = [];

  for (const move of captureMoves) {
    // Simulate move to check for multi-jumps
    const tempBoard = board.map(r => r.map(p => p ? { ...p } : null));
    
    // Remove captured piece
    tempBoard[move.captures[0].row][move.captures[0].col] = null;
    // Move piece
    tempBoard[move.to.row][move.to.col] = tempBoard[move.from.row][move.from.col];
    tempBoard[move.from.row][move.from.col] = null;

    // Check promotion within chain
    const isMan = !piece.isKing;
    const isWhite = piece.color === 'white';
    const reachedEnd = (isWhite && move.to.row === 0) || (!isWhite && move.to.row === BOARD_SIZE - 1);
    
    if (isMan && reachedEnd) {
      // Promotion terminates the sequence
      results.push({ moves: [...currentChain, move], count: currentChain.length + 1 });
    } else {
      // Continue recursion
      const subChains = getMaxCaptureChain(tempBoard, move.to, [...currentChain, move]);
      if (subChains.length === 0) {
         results.push({ moves: [...currentChain, move], count: currentChain.length + 1 });
      } else {
        results = [...results, ...subChains];
      }
    }
  }

  return results;
};


// Main function to get legal moves for the turn
export const getValidMovesForPlayer = (
  board: BoardState,
  player: PlayerColor,
  mustCaptureFrom: Position | null
): Move[] => {
  let allMoves: Move[] = [];
  
  // 1. Identify all pieces for the player
  const pieces: { pos: Position, piece: Piece }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c]?.color === player) {
        pieces.push({ pos: { row: r, col: c }, piece: board[r][c]! });
      }
    }
  }

  // 2. Calculate capture chains for all pieces
  let maxCaptureCount = 0;
  const captureSequences: { start: Position, moves: Move[], count: number }[] = [];

  // If locked to a specific piece (multi-jump in progress)
  const targetPieces = mustCaptureFrom 
    ? pieces.filter(p => p.pos.row === mustCaptureFrom.row && p.pos.col === mustCaptureFrom.col)
    : pieces;

  for (const { pos } of targetPieces) {
    const chains = getMaxCaptureChain(board, pos);
    for (const chain of chains) {
      if (chain.count > maxCaptureCount) maxCaptureCount = chain.count;
      captureSequences.push({ start: pos, moves: chain.moves, count: chain.count });
    }
  }

  // 3. If captures exist, enforce Max Capture Rule
  if (maxCaptureCount > 0) {
    // Filter sequences that match the max count
    const bestSequences = captureSequences.filter(s => s.count === maxCaptureCount);
    
    // Flatten to just the immediate valid next moves
    const distinctMoves = new Map<string, Move>(); 
    
    bestSequences.forEach(seq => {
        const firstMove = seq.moves[0]; // The immediate next step
        const key = `${firstMove.from.row}-${firstMove.from.col}-${firstMove.to.row}-${firstMove.to.col}`;
        distinctMoves.set(key, firstMove);
    });

    return Array.from(distinctMoves.values());
  }

  // 4. If no captures, get simple moves (only if not locked to a piece)
  if (!mustCaptureFrom) {
     for (const { pos, piece } of pieces) {
       const simpleMoves = getMovesForPiece(board, pos, piece);
       allMoves.push(...simpleMoves);
     }
  }

  return allMoves;
};

// Pure function to apply a move and return the new state details
// This is used by both the Game Engine (App.tsx) and the AI (ai.ts)
export const applyMove = (board: BoardState, move: Move): MoveResult => {
  const newBoard = board.map((row) => row.map((p) => (p ? { ...p } : null)));
  const movingPiece = newBoard[move.from.row][move.from.col]!;

  // Move Piece
  newBoard[move.to.row][move.to.col] = movingPiece;
  newBoard[move.from.row][move.from.col] = null;

  // Remove Captured Pieces
  const captured = move.captures.length > 0;
  if (captured) {
    move.captures.forEach((pos) => {
      newBoard[pos.row][pos.col] = null;
    });
  }

  // Handle Promotion
  let promoted = false;
  if (!movingPiece.isKing) {
    if ((movingPiece.color === 'white' && move.to.row === 0) ||
        (movingPiece.color === 'black' && move.to.row === BOARD_SIZE - 1)) {
      movingPiece.isKing = true;
      promoted = true;
    }
  }

  // Determine if turn continues
  let mustCaptureFrom: Position | null = null;
  let turnEnded = true;

  if (captured && !promoted) {
    // Check if more captures are available for this specific piece
    const nextMoves = getValidMovesForPlayer(newBoard, movingPiece.color, move.to);
    // If next moves exist (and they must be captures because getValidMovesForPlayer enforces max capture locally if mustCaptureFrom is set),
    // but we need to be careful: getValidMovesForPlayer returns moves.
    // If we pass 'move.to' as 'mustCaptureFrom', it will return captures if any exist.
    if (nextMoves.length > 0) {
       mustCaptureFrom = move.to;
       turnEnded = false;
    }
  }

  return {
    board: newBoard,
    turnEnded,
    mustCaptureFrom,
    promoted,
    captured
  };
};

export const checkWinner = (board: BoardState): PlayerColor | 'draw' | null => {
  let whiteCount = 0;
  let blackCount = 0;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c]?.color === 'white') whiteCount++;
      if (board[r][c]?.color === 'black') blackCount++;
    }
  }

  if (whiteCount === 0) return 'black';
  if (blackCount === 0) return 'white';
  
  return null; 
};