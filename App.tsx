import React, { useState, useEffect, useCallback } from 'react';
import { COLORS } from './constants';
import { BoardState, Move, PlayerColor, Position, SerializedGame, GameMode, HistoryState } from './types';
import { createInitialBoard, getValidMovesForPlayer, applyMove } from './utils/gameLogic';
import { getBestMove } from './utils/ai';
import { Piece } from './components/Piece';
import { saveGame, loadGame } from './services/db';
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
  const [previewMove, setPreviewMove] = useState<Move | null>(null);

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

  // --- Actions ---

  const executeMove = useCallback((move: Move) => {
    // 1. Save History (Snapshot BEFORE move)
    setHistory(prev => [...prev, {
      board: JSON.parse(JSON.stringify(board)), // Deep copy
      turn,
      mustCaptureFrom
    }]);

    // 2. Apply Move using shared logic
    const { board: newBoard, turnEnded, mustCaptureFrom: nextMustCaptureFrom, promoted, captured } = applyMove(board, move);

    // 3. Play Sounds
    if (promoted) {
      playSound('king');
    } else {
      playSound(captured ? 'capture' : 'move');
    }

    // 4. Update State
    setBoard(newBoard);
    setLastMove({ from: move.from, to: move.to });
    setMustCaptureFrom(nextMustCaptureFrom);

    if (turnEnded) {
      setTurn(prev => prev === 'white' ? 'black' : 'white');
      setSelectedPos(null);
    } else {
      // If turn continues, auto-select the piece
      setSelectedPos(move.to);
    }
  }, [board, turn, mustCaptureFrom]);

  // --- AI Logic Hook ---
  useEffect(() => {
    if (winner || !isDataLoaded || showMenu) return;

    // Trigger AI logic ONLY if it is Black's turn and Game Mode is PvE
    if (gameMode === 'pve' && turn === 'black') {
      let cancelled = false;

      const runAiTurn = async () => {
        setIsAiThinking(true);

        // 1. Thinking Time Simulation
        await new Promise(resolve => setTimeout(resolve, 600));
        if (cancelled) return;

        // 2. Calculate Move
        const bestMove = getBestMove(board, 'black', mustCaptureFrom);
        
        if (!bestMove) {
          setWinner('white'); // Human wins
          playSound('win');
          setIsAiThinking(false);
          return;
        }

        // 3. Highlight/Preview
        setPreviewMove(bestMove);
        await new Promise(resolve => setTimeout(resolve, 500));
        if (cancelled) return;

        // 4. Execute
        executeMove(bestMove);
        setPreviewMove(null);
        setIsAiThinking(false);
      };

      runAiTurn();

      return () => {
        cancelled = true;
      };
    }
  }, [board, turn, gameMode, winner, isDataLoaded, mustCaptureFrom, showMenu, executeMove]);

  // --- Core Game Loop (Human) ---
  useEffect(() => {
    if (!isDataLoaded || winner || (gameMode === 'pve' && turn === 'black')) {
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
    if (winner) setWinner(null);

    // Logic for Undo in PvE:
    // If it is White's turn, we must undo Black's move AND White's previous move.
    // However, if we are in the middle of a multi-jump (turn didn't change), just undo one step.
    
    let stepsToPop = 1;
    
    if (gameMode === 'pve' && turn === 'white') {
        if (history.length >= 1) {
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
        setLastMove(null);
        setSelectedPos(null);
        setPreviewMove(null);
        setIsAiThinking(false);
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
    setPreviewMove(null);
    setIsAiThinking(false);
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
    
    // AI Preview Highlights
    const isPreviewFrom = previewMove?.from.row === r && previewMove?.from.col === c;
    const isPreviewTo = previewMove?.to.row === r && previewMove?.to.col === c;

    let classes = `relative w-full h-full flex items-center justify-center select-none transition-colors duration-150 `;
    
    if (!isDark) {
      classes += COLORS.boardLight;
    } else {
      classes += COLORS.boardDark;
    }

    if (isSelected) classes += ` ${COLORS.highlight} z-10`;
    if (isPreviewFrom || isPreviewTo) classes += ` bg-orange-500/50 ring-4 ring-orange-400 z-20`;
    else if ((isLastMoveFrom || isLastMoveTo) && !isSelected) classes += ` ${COLORS.lastMove}`;
    
    if (isValidTarget) classes += ` cursor-pointer hover:bg-green-500/30`;

    return { classes, isValidTarget };
  };

  if (!isDataLoaded) return <div className="fixed inset-0 flex items-center justify-center bg-slate-900 text-white font-bold">Loading...</div>;

  return (
    <div className="min-h-[100dvh] bg-slate-900 flex flex-col text-slate-100">
      
      {/* HEADER */}
      <header className="flex-none bg-slate-800/80 backdrop-blur border-b border-slate-700 z-30 shadow-md">
        <div className="max-w-3xl mx-auto w-full px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">Dama</h1>
                <div className="hidden sm:flex text-xs text-slate-400 gap-2 items-center border-l border-slate-600 pl-3">
                    <span className="bg-slate-700 px-2 py-0.5 rounded text-slate-200">{gameMode === 'pve' ? 'vs AI' : '2 Player'}</span>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                <div className={`px-3 py-1 rounded-full font-bold shadow-sm flex items-center gap-2 text-xs md:text-sm transition-colors ${turn === 'white' ? 'bg-slate-100 text-slate-900' : 'bg-slate-700 text-slate-100 border border-slate-600'}`}>
                    <div className={`w-2 h-2 rounded-full ${turn === 'white' ? 'bg-slate-900' : 'bg-slate-100'}`}></div>
                    {winner ? "Game Over" : (gameMode === 'pve' && turn === 'black' ? 'Thinking...' : (turn === 'white' ? "White" : "Black"))}
                </div>
                <button onClick={() => setShowRules(true)} className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-700 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                </button>
            </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        
        {/* Board Container - Standard Responsive Box */}
        <div className="w-full max-w-lg aspect-square relative shadow-2xl bg-slate-800 border-4 border-slate-700 rounded-lg overflow-hidden">
          
            {/* The Grid */}
            <div className="w-full h-full grid grid-cols-8 grid-rows-8">
                {board.map((row, r) => 
                row.map((piece, c) => {
                    const { classes, isValidTarget } = getCellClass(r, c);
                    return (
                    <div 
                        key={`${r}-${c}`}
                        className={classes}
                        onClick={() => handleSquareClick(r, c)}
                    >
                        {/* Valid Move Indicator */}
                        {isValidTarget && (
                        <div className="absolute w-[30%] h-[30%] rounded-full bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.6)] z-20 pointer-events-none animate-pulse" />
                        )}
                        
                        {/* Coordinates (Only A1) */}
                        {c === 0 && r === 7 && <span className="absolute bottom-0.5 left-1 text-[8px] sm:text-[10px] text-slate-500 font-mono select-none">A1</span>}

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

            {/* Overlays (Winner / Menu) */}
            {(winner || showMenu) && (
                <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-xs sm:max-w-sm flex flex-col gap-4 animate-in fade-in zoom-in duration-300">
                        <div className="text-center mb-2">
                            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-1">
                                {showMenu ? "Filipino Dama" : (winner === 'draw' ? 'Draw!' : `${winner === 'white' ? 'White' : 'Black'} Wins!`)}
                            </h2>
                            <p className="text-slate-400 text-sm">
                                {showMenu ? "Classic Flying Kings Rules" : (gameMode === 'pve' && winner === 'white' ? "Victory!" : "Game Over")}
                            </p>
                        </div>

                        <div className="flex flex-col gap-3">
                            {showMenu ? (
                                <>
                                    <button onClick={() => startNewGame('pve')} className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2">
                                        <span>Single Player</span>
                                        <span className="text-amber-200 text-xs font-normal">(vs AI)</span>
                                    </button>
                                    <button onClick={() => startNewGame('pvp')} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95">
                                        Two Player
                                    </button>
                                    {history.length > 0 && (
                                        <button onClick={() => setShowMenu(false)} className="mt-2 text-slate-400 text-sm hover:text-white underline">Resume Game</button>
                                    )}
                                </>
                            ) : (
                                <>
                                    <button onClick={() => setShowMenu(true)} className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95">
                                        Play Again
                                    </button>
                                    <button onClick={handleUndo} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl shadow-lg">
                                        Undo Last Move
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
      </main>

      {/* FOOTER */}
      {!showMenu && !winner && (
        <footer className="flex-none bg-slate-800/80 backdrop-blur border-t border-slate-700/50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
            <div className="max-w-3xl mx-auto w-full px-4 py-3 flex items-center justify-between">
                <button 
                    onClick={() => setShowMenu(true)}
                    className="text-slate-400 hover:text-white text-xs sm:text-sm font-medium px-2 py-1 rounded hover:bg-slate-700 transition-colors"
                >
                    Menu
                </button>
                
                <button 
                    onClick={handleUndo}
                    disabled={history.length === 0 || (gameMode === 'pve' && turn === 'black')}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-bold rounded-lg transition-colors shadow-sm"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74-2.74L3 12" /><path d="M3 3v9h9" /></svg>
                    Undo
                </button>
            </div>
        </footer>
      )}

      {/* Rules Modal */}
      {showRules && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setShowRules(false)}>
            <div className="bg-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-700" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white">How to Play</h3>
                    <button onClick={() => setShowRules(false)} className="text-slate-400 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                </div>
                <ul className="space-y-2 text-slate-300 text-sm list-disc pl-4 marker:text-amber-500">
                    <li><strong>Move:</strong> Diagonal forward only (Men).</li>
                    <li><strong>King:</strong> Move any distance diagonally (Flying King).</li>
                    <li><strong>Capture:</strong> Mandatory! You must capture if possible.</li>
                    <li><strong>Max Capture:</strong> If multiple paths exist, you must take the one with the MOST captures.</li>
                </ul>
                <button onClick={() => setShowRules(false)} className="w-full mt-6 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-colors">Close</button>
            </div>
        </div>
      )}
    </div>
  );
};

export default App;