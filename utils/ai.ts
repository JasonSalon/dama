import { BoardState, Move, PlayerColor, Position } from '../types';
import { getValidMovesForPlayer, applyMove, checkWinner } from './gameLogic';
import { BOARD_SIZE } from '../constants';

// Evaluation Weights
const KING_VALUE = 50;
const MAN_VALUE = 10;
const DEPTH = 3; // Reduced from 4 to 3 for performance/stability

// Position bonuses for Men (encourages center control and advancement)
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
        // Orient bonus table: Black moves 0->7, White moves 7->0
        // We want the bonus array index 0 to be the "End" (Promotion) line for both.
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
    // If current player has no moves, they lose.
    // If it is Maximizing turn (Root Player's turn), and they have no moves -> They lose -> Bad score
    // If it is Minimizing turn (Opponent's turn), and they have no moves -> They lose -> Good score for Root
    return isMaximizing ? -10000 : 10000;
  }

  // 3. Recursion
  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const { board: nextBoard, turnEnded, mustCaptureFrom: nextCaptureFrom } = applyMove(board, move);
      
      const nextPlayer = turnEnded ? (currentPlayer === 'white' ? 'black' : 'white') : currentPlayer;
      // If turn continues, we are still optimizing for the same player.
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
  
  // Shuffle moves to add variety if scores are tied
  const shuffledMoves = [...moves].sort(() => Math.random() - 0.5);

  for (const move of shuffledMoves) {
    const { board: nextBoard, turnEnded, mustCaptureFrom: nextCaptureFrom } = applyMove(board, move);
    
    // Determine who plays next in the simulation
    const nextPlayer = turnEnded ? (player === 'white' ? 'black' : 'white') : player;
    
    // If turn didn't end, we are still maximizing (continuing our turn)
    // If turn ended, it's opponent's turn, so we minimize.
    const isMaximizing = !turnEnded; 
    
    const moveValue = minimax(
      nextBoard, 
      DEPTH - 1, 
      -Infinity, 
      Infinity, 
      isMaximizing, 
      nextCaptureFrom, 
      nextPlayer, 
      player // Root player maximizing
    );

    if (moveValue > bestValue) {
      bestValue = moveValue;
      bestMove = move;
    }
  }

  return bestMove;
};