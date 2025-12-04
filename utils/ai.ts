import { BoardState, Move, PlayerColor, Position } from '../types';
import { getValidMovesForPlayer, applyMove, checkWinner, isValidPos } from './gameLogic';
import { BOARD_SIZE } from '../constants';

// Evaluation Weights
const KING_VALUE = 50;
const MAN_VALUE = 10;
const POSITION_WEIGHT = 1;

// Position bonuses for Men (encourages center control and advancement)
// Flipped logic will be applied for White
const POSITIONAL_BONUS = [
  [0, 0, 0, 0, 0, 0, 0, 0], // Row 0 (End)
  [4, 2, 4, 2, 4, 2, 4, 2],
  [2, 3, 2, 3, 2, 3, 2, 3],
  [2, 4, 2, 4, 2, 4, 2, 4],
  [2, 4, 2, 4, 2, 4, 2, 4],
  [2, 3, 2, 3, 2, 3, 2, 3],
  [4, 2, 4, 2, 4, 2, 4, 2],
  [4, 4, 4, 4, 4, 4, 4, 4]  // Row 7 (Start)
];

const evaluateBoard = (board: BoardState, playerColor: PlayerColor): number => {
  let score = 0;
  const winner = checkWinner(board);
  
  if (winner === playerColor) return 10000;
  if (winner && winner !== 'draw') return -10000;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      let value = piece.isKing ? KING_VALUE : MAN_VALUE;

      // Positional Bonus for Men
      if (!piece.isKing) {
        // If Black (moving down 0 -> 7), use row index directly? 
        // Actually Black starts at 0-2 and moves to 7.
        // White starts at 5-7 and moves to 0.
        
        // Let's orient the bonus table so higher values are closer to promotion
        // For Black (Promotes at 7): Use r
        // For White (Promotes at 0): Use 7 - r
        const rowIdx = piece.color === 'black' ? r : (7 - r);
        value += POSITIONAL_BONUS[rowIdx][c] * 0.1;
      }

      if (piece.color === playerColor) {
        score += value;
      } else {
        score -= value;
      }
    }
  }
  return score;
};

// Minimax with Alpha-Beta Pruning
const minimax = (
  board: BoardState,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  mustCaptureFrom: Position | null,
  currentPlayer: PlayerColor,
  rootPlayer: PlayerColor
): number => {
  // 1. Termination conditions
  const winner = checkWinner(board);
  if (depth === 0 || winner) {
    return evaluateBoard(board, rootPlayer);
  }

  // 2. Get Moves
  const moves = getValidMovesForPlayer(board, currentPlayer, mustCaptureFrom);

  if (moves.length === 0) {
    // If current player has no moves, they lose
    return isMaximizing ? -10000 : 10000;
  }

  // 3. Recursion
  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const { board: nextBoard, turnEnded, mustCaptureFrom: nextCaptureFrom } = applyMove(board, move);
      
      const nextPlayer = turnEnded ? (currentPlayer === 'white' ? 'black' : 'white') : currentPlayer;
      // If turn continues, we are still maximizing (it's still our turn)
      // Wait, if it's still our turn, we are essentially extending the current ply.
      // We shouldn't reduce depth if it's a multi-jump forced sequence, to ensure we see the outcome.
      // But for safety against infinite loops (though unlikely in Dama), we can reduce depth or keep it same.
      // Let's reduce depth to treat every hop as a decision node, but strictly typically multi-jumps are one "move".
      // Simplified: Reduce depth.
      const nextIsMaximizing = turnEnded ? !isMaximizing : isMaximizing;
      
      const evalScore = minimax(nextBoard, depth - 1, alpha, beta, nextIsMaximizing, nextCaptureFrom, nextPlayer, rootPlayer);
      
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const { board: nextBoard, turnEnded, mustCaptureFrom: nextCaptureFrom } = applyMove(board, move);
      
      const nextPlayer = turnEnded ? (currentPlayer === 'white' ? 'black' : 'white') : currentPlayer;
      const nextIsMaximizing = turnEnded ? !isMaximizing : isMaximizing;
      
      const evalScore = minimax(nextBoard, depth - 1, alpha, beta, nextIsMaximizing, nextCaptureFrom, nextPlayer, rootPlayer);
      
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
};

export const getBestMove = (
  board: BoardState,
  player: PlayerColor,
  mustCaptureFrom: Position | null
): Move | null => {
  const moves = getValidMovesForPlayer(board, player, mustCaptureFrom);
  if (moves.length === 0) return null;

  // Optimization: If only one move (often forced capture), take it immediately
  if (moves.length === 1) return moves[0];

  let bestMove: Move | null = null;
  let bestValue = -Infinity;
  const depth = 4; // Search depth

  // Shuffle moves to add variety if scores are tied (and prevent deterministic repetition in identical states)
  const shuffledMoves = moves.sort(() => Math.random() - 0.5);

  for (const move of shuffledMoves) {
    const { board: nextBoard, turnEnded, mustCaptureFrom: nextCaptureFrom } = applyMove(board, move);
    
    // After we make our move, it's either still our turn (maximize) or opponent's turn (minimize)
    // Actually, minimax entry point usually starts with "opponent's turn to minimize".
    // If turnEnded, next is opponent (minimize).
    // If !turnEnded, next is US (maximize).
    
    const nextPlayer = turnEnded ? (player === 'white' ? 'black' : 'white') : player;
    const isMaximizing = !turnEnded; // If turn didn't end, we want to maximize the REST of our turn.
    
    const moveValue = minimax(
      nextBoard, 
      depth - 1, 
      -Infinity, 
      Infinity, 
      isMaximizing, 
      nextCaptureFrom, 
      nextPlayer, 
      player // We are the root player maximizing this score
    );

    if (moveValue > bestValue) {
      bestValue = moveValue;
      bestMove = move;
    }
  }

  return bestMove;
};