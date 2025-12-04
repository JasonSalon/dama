import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BOARD_SIZE, COLORS } from './constants';
import { BoardState, Move, PlayerColor, Position, SerializedGame, GameMode, HistoryState } from './types';
import { createInitialBoard, getValidMovesForPlayer } from './utils/gameLogic';
import { Piece } from './components/Piece';
import { saveGame, loadGame, clearGame } from './services/db';
import { playSound } from './utils/audio';

const App: React.FC = () => {
  // --- State ---
  const [board, setBoard] = useState<BoardState>(createInitialBoard());
  const [turn, setTurn] = useState<PlayerColor>('white');
  const [gameMode, setGameMode] = useState<GameMode>('pvp');
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [validMoves, setValidMoves] = useState<Move[]>([]);
  const [mustCaptureFrom, setMustCaptureFrom] = useState<Position | null>(null);
  const [winner, setWinner] = useState<PlayerColor | 'draw' | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Position; to: Position } | null>(null);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  
  // AI State
  const [isAiThinking, setIsAiThinking] = useState(false);

  // --- Initialization ---
  useEffect(() => {
    const init = async () => {
      const savedGame = await loadGame();
      if (savedGame) {
        setBoard(savedGame.board);
        setTurn(savedGame.turn);
        setWinner(savedGame.winner);
        setMustCaptureFrom(savedGame.mustCaptureFrom);
        setGameMode(savedGame.gameMode || 'pvp');
        setHistory(savedGame.history || []);
        setShowMenu(false);
      } else {
        setShowMenu(true);
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
        gameMode,
        history
      };
      saveGame(gameState);
    }
  }, [board, turn, winner, mustCaptureFrom, gameMode, history, isDataLoaded]);

  // --- AI Logic Hook ---
  useEffect(() => {
    if (winner || !isDataLoaded || showMenu) return;

    // AI only plays Black in PvE
    if (gameMode === 'pve' && turn === 'black' && !isAiThinking) {
      setIsAiThinking(true);
      
      const aiTimeout = setTimeout(() => {
        // Calculate moves
        const moves = getValidMovesForPlayer(board, 'black', mustCaptureFrom);
        
        if (moves.length === 0) {
          setWinner('white'); // Human wins
          playSound('win');
          setIsAiThinking(false);
          return;
        }

        // Simple AI: Random Valid Move
        // Since getValidMovesForPlayer already enforces Max Capture rules, any move here is "optimal" by rule,
        // though strategy (positioning) is random.
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        executeMove(randomMove);
        setIsAiThinking(false);
      }, 1000); // 1 second thinking time

      return () => clearTimeout(aiTimeout);
    }
  }, [board, turn, gameMode, winner, isDataLoaded, mustCaptureFrom, isAiThinking]);

  // --- Core Game Loop (Human) ---
  useEffect(() => {
    if (!isDataLoaded || winner || (gameMode === 'pve' && turn === 'black')) {
      // Don't calculate moves for UI if game over or it's AI's turn
      if (gameMode !== 'pve' || turn !== 'black') {
          // Keep moves clear if not interactive
      }
      return;
    }

    const moves = getValidMovesForPlayer(board, turn, mustCaptureFrom);

    if (moves.length === 0) {
      const opponent = turn === 'white' ? 'black' : 'white';
      setWinner(opponent);
      playSound('win');
      setValidMoves([]);
      return;
    }

    setValidMoves(moves);

    // Auto-select locked piece
    if (mustCaptureFrom) {
      setSelectedPos(mustCaptureFrom);
    } else if (selectedPos) {
        // Re-validate selection
        const isSelectedStillValid = moves.some(
          (m) => m.from.row === selectedPos.row && m.from.col === selectedPos.col
        );
        if (!isSelectedStillValid) {
          setSelectedPos(null);
        }
    }
  }, [board, turn, mustCaptureFrom, winner, isDataLoaded, selectedPos?.row, selectedPos?.col, gameMode]);


  // --- Actions ---

  const executeMove = (move: Move) => {
    // 1. Save History (Snapshot BEFORE move)
    // Only save history if starting a new turn or sequence, avoid saving every step of a multi-jump if handled differently,
    // but for simplicity, we save every state change so Undo is granular.
    setHistory(prev => [...prev, {
      board: JSON.parse(JSON.stringify(board)), // Deep copy
      turn,
      mustCaptureFrom
    }]);

    const newBoard = board.map((row) => row.map((p) => (p ? { ...p } : null)));
    const movingPiece = newBoard[move.from.row][move.from.col]!;

    // 2. Move Piece
    newBoard[move.to.row][move.to.col] = movingPiece;
    newBoard[move.from.row][move.from.col] = null;

    // 3. Remove Captured Pieces
    let captureSound = false;
    if (move.captures.length > 0) {
      captureSound = true;
      move.captures.forEach((pos) => {
        newBoard[pos.row][pos.col] = null;
      });
    }

    // 4. Handle Promotion
    let promoted = false;
    if (!movingPiece.isKing) {
      if ((movingPiece.color === 'white' && move.to.row === 0) ||
          (movingPiece.color === 'black' && move.to.row === BOARD_SIZE - 1)) {
        movingPiece.isKing = true;
        promoted = true;
        playSound('king');
      }
    }

    if (!promoted) {
      playSound(captureSound ? 'capture' : 'move');
    }

    // 5. Update Board
    setBoard(newBoard);
    setLastMove({ from: move.from, to: move.to });

    const wasCapture = move.captures.length > 0;

    // 6. Next Turn Logic
    if (wasCapture && !promoted) {
      // Check for multi-jump
      const nextMoves = getValidMovesForPlayer(newBoard, turn, move.to);
      if (nextMoves.length > 0) {
        setMustCaptureFrom(move.to);
        setSelectedPos(move.to);
      } else {
        endTurn();
      }
    } else {
      endTurn();
    }
  };

  const endTurn = () => {
    setTurn(prev => prev === 'white' ? 'black' : 'white');
    setMustCaptureFrom(null);
    setSelectedPos(null);
  };

  const handleSquareClick = (r: number, c: number) => {
    if (winner || !isDataLoaded || showMenu) return;
    if (gameMode === 'pve' && turn === 'black') return; // Cannot click during AI turn

    // 1. Execute Move
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

    // 2. Select Piece
    const clickedPiece = board[r][c];
    if (clickedPiece?.color === turn) {
      if (mustCaptureFrom) {
        if (mustCaptureFrom.row === r && mustCaptureFrom.col === c) return;
        return; // Locked
      }

      const hasMoves = validMoves.some((m) => m.from.row === r && m.from.col === c);
      if (hasMoves) {
        setSelectedPos({ row: r, col: c });
      } else {
        setSelectedPos(null);
      }
      return;
    }

    // 3. Deselect
    if (!mustCaptureFrom) {
      setSelectedPos(null);
    }
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    if (winner) setWinner(null); // Reset winner state if undoing the winning move

    // If PvE and it's White's turn, we need to undo Black's move AND White's previous move
    // to get back to White's turn.
    // However, if we are in the middle of a multi-jump, just undo one step.
    
    let stepsToPop = 1;
    
    // Logic: 
    // If PvE:
    //   If Current Turn is White (Human) AND History[last] was Black (AI) -> Undo 2 steps (AI then Human)
    //   If Current Turn is Black (AI) -> Undo 1 step (Human just moved) - but usually AI moves instantly.
    //   Wait, AI moves are async. If I hit undo while AI is "thinking", we should cancel logic?
    //   The simplest reliable undo is single step, but for PvE it feels weird to undo to the AI's turn.
    
    // Better Logic:
    // Just pop one state. The user will see the board revert.
    // If it reverts to AI's turn, the AI effect will trigger immediately and move again?
    // YES. So in PvE, if I undo, I go back to start of AI turn, AI moves immediately again (maybe same move).
    // So effectively I can't undo my move unless I undo TWICE.
    
    if (gameMode === 'pve') {
       // If it is currently White's turn, the last history item was start of Black's turn. 
       // The item before that was start of White's turn.
       // We likely want to go back to start of White's turn.
       if (turn === 'white' && history.length >= 2) {
          // Check if previous turn in history was Black
          const lastState = history[history.length - 1];
          if (lastState.turn === 'black') {
             stepsToPop = 2;
          }
       }
    }

    const newHistory = [...history];
    let targetState: HistoryState | undefined;
    
    for(let i=0; i<stepsToPop; i++) {
        targetState = newHistory.pop();
    }

    if (targetState) {
        setBoard(targetState.board);
        setTurn(targetState.turn);
        setMustCaptureFrom(targetState.mustCaptureFrom);
        setHistory(newHistory);
        setLastMove(null); // Clear last move highlight or store in history if needed (optional refinement)
        setSelectedPos(null);
        playSound('move');
    }
  };

  const startNewGame = (mode: GameMode) => {
    setBoard(createInitialBoard());
    setTurn('white');
    setWinner(null);
    setMustCaptureFrom(null);
    setLastMove(null);
    setValidMoves([]);
    setSelectedPos(null);
    setHistory([]);
    setGameMode(mode);
    setShowMenu(false);
    playSound('start');
  };

  // --- Render Helpers ---
  const getCellClass = (r: number, c: number) => {
    const isDark = (r + c) % 2 !== 0;
    const isSelected = selectedPos?.row === r && selectedPos?.col === c;
    const isLastMoveFrom = lastMove?.from.row === r && lastMove?.from.col === c;
    const isLastMoveTo = lastMove?.to.row === r && lastMove?.to.col === c;
    const isValidTarget = selectedPos && validMoves.some(m => 
      m.from.row === selectedPos.row && m.from.col === selectedPos.col && m.to.row === r && m.to.col === c
    );

    let classes = `relative w-full h-full flex items-center justify-center select-none transition-colors duration-150 `;
    
    if (!isDark) {
      classes += COLORS.boardLight;
    } else {
      classes += COLORS.boardDark;
    }

    if (isSelected) classes += ` ${COLORS.highlight} z-10`;
    if ((isLastMoveFrom || isLastMoveTo) && !isSelected) classes += ` ${COLORS.lastMove}`;
    if (isValidTarget) classes += ` cursor-pointer hover:bg-green-500/30`;

    return { classes, isValidTarget };
  };

  if (!isDataLoaded) return <div className="flex h-screen items-center justify-center bg-slate-900 text-white font-bold">Loading Dama...</div>;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 touch-none">
      
      {/* Header */}
      <div className="w-full max-w-lg flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-100 tracking-tight">Filipino Dama</h1>
          <div className="flex gap-2 text-xs text-slate-400">
             <span>{gameMode === 'pve' ? 'vs Computer' : '2 Player'}</span>
             <span>•</span>
             <button onClick={() => setShowRules(true)} className="underline hover:text-amber-400">Rules</button>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2">
            <div className={`px-4 py-2 rounded-lg font-bold shadow-lg flex items-center gap-2 transition-colors duration-300 ${turn === 'white' ? 'bg-slate-100 text-slate-900' : 'bg-slate-800 text-slate-100 border border-slate-600'}`}>
            <div className={`w-3 h-3 rounded-full ${turn === 'white' ? 'bg-slate-900' : 'bg-slate-100'}`}></div>
            {winner ? "Game Over" : (
                gameMode === 'pve' && turn === 'black' ? 'Computer...' : (turn === 'white' ? "White's Turn" : "Black's Turn")
            )}
            </div>
        </div>
      </div>

      {/* Board Container */}
      <div className="relative w-full max-w-lg aspect-square bg-slate-800 rounded-lg border-4 border-slate-700 shadow-2xl overflow-hidden">
        
        {/* Main Board Grid */}
        <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
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
                    <div className="absolute w-3 h-3 md:w-5 md:h-5 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)] z-20 pointer-events-none" />
                  )}
                  
                  {/* Coordinate Labels */}
                  {c === 0 && r === 7 && <span className="absolute bottom-0.5 left-1 text-[8px] md:text-[10px] text-slate-400 font-mono">A1</span>}

                  {/* Piece */}
                  {piece && (
                    <div className="z-10 w-full h-full flex items-center justify-center p-[10%]">
                      <Piece piece={piece} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Winner Overlay */}
        {winner && (
          <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-in fade-in zoom-in duration-300">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-2 drop-shadow-lg text-center">
              {winner === 'draw' ? 'Draw!' : `${winner === 'white' ? 'White' : 'Black'} Wins!`}
            </h2>
            <p className="text-amber-400 font-semibold text-lg mb-8">
                {gameMode === 'pve' && winner === 'white' ? "You defeated the Computer!" : ""}
                {gameMode === 'pve' && winner === 'black' ? "The Computer Won!" : ""}
            </p>
            <div className="flex gap-4">
                <button 
                  onClick={handleUndo}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-full shadow-lg transition-all"
                >
                  Undo Last
                </button>
                <button 
                  onClick={() => setShowMenu(true)}
                  className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-full shadow-lg transition-all transform hover:scale-105 active:scale-95"
                >
                  New Game
                </button>
            </div>
          </div>
        )}

        {/* Main Menu Overlay */}
        {showMenu && (
             <div className="absolute inset-0 bg-slate-900 z-50 flex flex-col items-center justify-center p-6 text-center">
                 <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">Filipino Dama</h1>
                 <p className="text-slate-400 mb-8 max-w-xs">Play the traditional checkers variant with flying kings and mandatory captures.</p>
                 
                 <div className="flex flex-col gap-3 w-full max-w-xs">
                     <button onClick={() => startNewGame('pve')} className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-lg transition-all transform hover:scale-105">
                        Play vs Computer
                     </button>
                     <button onClick={() => startNewGame('pvp')} className="w-full py-4 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl shadow-lg transition-all">
                        2 Player Local
                     </button>
                     {history.length > 0 && (
                         <button onClick={() => setShowMenu(false)} className="mt-4 text-slate-400 underline hover:text-white">
                             Resume Game
                         </button>
                     )}
                 </div>
             </div>
        )}
      </div>

      {/* Footer Controls */}
      {!showMenu && !winner && (
        <div className="mt-6 flex w-full max-w-lg justify-between gap-4">
           <button 
            onClick={() => setShowMenu(true)}
            className="px-4 py-2 text-slate-400 hover:text-white transition-colors text-sm font-semibold"
          >
            Menu
          </button>

          <div className="flex gap-3">
            <button 
                onClick={handleUndo}
                disabled={history.length === 0 || (gameMode === 'pve' && turn === 'black')}
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 rounded-lg font-semibold transition-colors shadow-md flex items-center gap-2"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74-2.74L3 12" /><path d="M3 3v9h9" /></svg>
                Undo
            </button>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      {showRules && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowRules(false)}>
              <div className="bg-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-700 overflow-y-auto max-h-[80vh]" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-4">
                      <h2 className="text-2xl font-bold text-white">Rules of Dama</h2>
                      <button onClick={() => setShowRules(false)} className="text-slate-400 hover:text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                  </div>
                  <div className="space-y-4 text-slate-300 text-sm leading-relaxed">
                      <p><strong className="text-amber-400">Movement:</strong> Men move one step diagonally forward. Kings move any number of steps diagonally (Flying Kings).</p>
                      <p><strong className="text-amber-400">Capturing:</strong> Capturing is mandatory! If you can capture, you must.</p>
                      <p><strong className="text-amber-400">Max Capture Rule:</strong> If multiple capture paths exist, you must choose the one that captures the MOST pieces.</p>
                      <p><strong className="text-amber-400">Promotion:</strong> A piece becomes a King when it ends its turn on the opposite edge of the board.</p>
                      <p><strong className="text-amber-400">Winning:</strong> Capture all enemy pieces or block them so they cannot move.</p>
                  </div>
                  <button onClick={() => setShowRules(false)} className="w-full mt-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold">Got it</button>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;