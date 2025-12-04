import React, { useState, useEffect, useRef } from 'react';
import { BOARD_SIZE, COLORS } from './constants';
import { BoardState, Move, PlayerColor, Position, SerializedGame } from './types';
import { createInitialBoard, getValidMovesForPlayer } from './utils/gameLogic';
import { Piece } from './components/Piece';
import { saveGame, loadGame, clearGame } from './services/db';

const App: React.FC = () => {
  // --- State ---
  const [board, setBoard] = useState<BoardState>(createInitialBoard());
  const [turn, setTurn] = useState<PlayerColor>('white');
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [validMoves, setValidMoves] = useState<Move[]>([]);
  const [mustCaptureFrom, setMustCaptureFrom] = useState<Position | null>(null);
  const [winner, setWinner] = useState<PlayerColor | 'draw' | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Position; to: Position } | null>(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // --- Initialization ---
  useEffect(() => {
    const init = async () => {
      const savedGame = await loadGame();
      if (savedGame) {
        setBoard(savedGame.board);
        setTurn(savedGame.turn);
        setWinner(savedGame.winner);
        setMustCaptureFrom(savedGame.mustCaptureFrom);
      }
      setIsDataLoaded(true);
    };
    init();
  }, []);

  // --- Auto-Save ---
  useEffect(() => {
    if (isDataLoaded) {
      const gameState: SerializedGame = {
        board,
        turn,
        winner,
        mustCaptureFrom,
      };
      saveGame(gameState);
    }
  }, [board, turn, winner, mustCaptureFrom, isDataLoaded]);

  // --- Logic Loop ---
  useEffect(() => {
    if (!isDataLoaded || winner) {
      setValidMoves([]);
      return;
    }

    const moves = getValidMovesForPlayer(board, turn, mustCaptureFrom);

    // Check for loss condition (no moves available)
    if (moves.length === 0) {
      const opponent = turn === 'white' ? 'black' : 'white';
      setWinner(opponent);
      setValidMoves([]);
      return;
    }

    setValidMoves(moves);

    // If locked into a multi-jump, auto-select the piece
    if (mustCaptureFrom) {
      setSelectedPos(mustCaptureFrom);
    } else {
      // If the currently selected piece is no longer valid (e.g., due to max capture rule enforcing another piece), deselect it
      if (selectedPos) {
        const isSelectedStillValid = moves.some(
          (m) => m.from.row === selectedPos.row && m.from.col === selectedPos.col
        );
        if (!isSelectedStillValid) {
          setSelectedPos(null);
        }
      }
    }
  }, [board, turn, mustCaptureFrom, winner, isDataLoaded, selectedPos?.row, selectedPos?.col]);

  // --- Interaction Handlers ---

  const handleSquareClick = (r: number, c: number) => {
    if (winner || !isDataLoaded) return;

    // 1. Check if clicking a Valid Move Target
    if (selectedPos) {
      const move = validMoves.find(
        (m) =>
          m.from.row === selectedPos.row &&
          m.from.col === selectedPos.col &&
          m.to.row === r &&
          m.to.col === c
      );

      if (move) {
        executeMove(move);
        return;
      }
    }

    // 2. Select a Piece
    const clickedPiece = board[r][c];
    if (clickedPiece?.color === turn) {
      // If locked in multi-jump, prevent selecting other pieces
      if (mustCaptureFrom) {
        if (mustCaptureFrom.row === r && mustCaptureFrom.col === c) {
          // Already selected, do nothing
          return;
        }
        // Cannot select other pieces
        return;
      }

      // Allow selection only if the piece has valid moves (enforcing max capture rule filters)
      const hasMoves = validMoves.some((m) => m.from.row === r && m.from.col === c);
      if (hasMoves) {
        setSelectedPos({ row: r, col: c });
      } else {
        // Visual feedback could go here (e.g. shake animation).
        // For now, we simply don't select invalid pieces.
        setSelectedPos(null);
      }
      return;
    }

    // 3. Click elsewhere -> Deselect
    if (!mustCaptureFrom) {
      setSelectedPos(null);
    }
  };

  const executeMove = (move: Move) => {
    const newBoard = board.map((row) => row.map((p) => (p ? { ...p } : null)));
    const movingPiece = newBoard[move.from.row][move.from.col]!;

    // 1. Move Piece
    newBoard[move.to.row][move.to.col] = movingPiece;
    newBoard[move.from.row][move.from.col] = null;

    // 2. Remove Captured Pieces
    if (move.captures.length > 0) {
      move.captures.forEach((pos) => {
        newBoard[pos.row][pos.col] = null;
      });
    }

    // 3. Handle Promotion
    let promoted = false;
    if (!movingPiece.isKing) {
      if ((movingPiece.color === 'white' && move.to.row === 0) ||
          (movingPiece.color === 'black' && move.to.row === BOARD_SIZE - 1)) {
        movingPiece.isKing = true;
        promoted = true;
      }
    }

    // 4. Update Game State
    setBoard(newBoard);
    setLastMove({ from: move.from, to: move.to });

    const wasCapture = move.captures.length > 0;

    // 5. Determine Next Turn Logic
    // If it was a capture, and NOT a promotion (promotion usually ends turn immediately in Dama),
    // check if further captures are possible.
    if (wasCapture && !promoted) {
      // We need to calculate valid moves for the *new* state to see if the chain continues
      // We temporarily pass the new board state to our logic function
      const nextMoves = getValidMovesForPlayer(newBoard, turn, move.to);
      
      if (nextMoves.length > 0) {
        // Multi-jump available: Force player to keep playing from new position
        setMustCaptureFrom(move.to);
        setSelectedPos(move.to); // Auto-select for UX
      } else {
        // Chain ended
        endTurn();
      }
    } else {
      // Normal move or Promotion ends turn
      endTurn();
    }
  };

  const endTurn = () => {
    setTurn(turn === 'white' ? 'black' : 'white');
    setMustCaptureFrom(null);
    setSelectedPos(null);
  };

  const handleNewGame = async () => {
    await clearGame();
    setBoard(createInitialBoard());
    setTurn('white');
    setWinner(null);
    setMustCaptureFrom(null);
    setLastMove(null);
    setValidMoves([]);
    setSelectedPos(null);
  };

  // --- Rendering Helpers ---

  const getCellClass = (r: number, c: number) => {
    const isDark = (r + c) % 2 !== 0;
    const isSelected = selectedPos?.row === r && selectedPos?.col === c;
    const isLastMoveFrom = lastMove?.from.row === r && lastMove?.from.col === c;
    const isLastMoveTo = lastMove?.to.row === r && lastMove?.to.col === c;
    const isValidTarget = selectedPos && validMoves.some(m => 
      m.from.row === selectedPos.row && m.from.col === selectedPos.col && m.to.row === r && m.to.col === c
    );

    let classes = `relative w-full h-full flex items-center justify-center select-none `;
    
    if (!isDark) {
      classes += COLORS.boardLight;
    } else {
      classes += COLORS.boardDark;
    }

    if (isSelected) classes += ` ${COLORS.highlight}`;
    if ((isLastMoveFrom || isLastMoveTo) && !isSelected) classes += ` ${COLORS.lastMove}`;
    if (isValidTarget) classes += ` cursor-pointer`;

    return { classes, isValidTarget };
  };

  if (!isDataLoaded) return <div className="flex h-screen items-center justify-center bg-slate-900 text-white">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="w-full max-w-lg flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Filipino Dama</h1>
          <p className="text-slate-400 text-sm">Flying Kings • Max Capture</p>
        </div>
        <div className={`px-4 py-2 rounded-lg font-bold shadow-lg flex items-center gap-2 ${turn === 'white' ? 'bg-slate-100 text-slate-900' : 'bg-slate-800 text-slate-100 border border-slate-600'}`}>
          <div className={`w-3 h-3 rounded-full ${turn === 'white' ? 'bg-slate-900' : 'bg-slate-100'}`}></div>
          {turn === 'white' ? "White's Turn" : "Black's Turn"}
        </div>
      </div>

      {/* Board Container */}
      <div className="relative w-full max-w-lg aspect-square bg-slate-800 rounded-lg border-4 border-slate-700 shadow-2xl overflow-hidden">
        <div 
          className="grid grid-cols-8 grid-rows-8 w-full h-full"
        >
          {board.map((row, r) => 
            row.map((piece, c) => {
              const { classes, isValidTarget } = getCellClass(r, c);
              return (
                <div 
                  key={`${r}-${c}`}
                  className={classes}
                  onClick={() => handleSquareClick(r, c)}
                >
                  {/* Valid Move Marker */}
                  {isValidTarget && (
                    <div className="absolute inset-0 m-auto w-4 h-4 rounded-full bg-green-500/50 animate-pulse z-0 pointer-events-none" />
                  )}
                  
                  {/* Piece */}
                  {piece && (
                    <div className="z-10 w-full h-full flex items-center justify-center">
                      <Piece piece={piece} />
                    </div>
                  )}
                  
                  {/* Coordinate Labels (Optional, for corners) */}
                  {c === 0 && r === 7 && <span className="absolute bottom-0.5 left-1 text-[10px] text-slate-400 font-mono">A1</span>}
                </div>
              );
            })
          )}
        </div>

        {/* Winner Overlay */}
        {winner && (
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-in fade-in duration-300">
            <h2 className="text-5xl font-bold text-white mb-2 drop-shadow-lg">
              {winner === 'draw' ? 'Draw!' : `${winner === 'white' ? 'White' : 'Black'} Wins!`}
            </h2>
            <p className="text-slate-300 mb-8">Game Over</p>
            <button 
              onClick={handleNewGame}
              className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-full shadow-lg transition-all transform hover:scale-105 active:scale-95"
            >
              Play Again
            </button>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="mt-8 flex gap-4">
        <button 
          onClick={handleNewGame}
          className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-semibold transition-colors shadow-md"
        >
          New Game
        </button>
      </div>
    </div>
  );
};

export default App;
