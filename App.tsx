import React, { useState, useEffect, useCallback, useRef } from 'react';
import { COLORS, TURN_DURATION } from './constants';
import { BoardState, Move, PlayerColor, Position, SerializedGame, GameMode, HistoryState, User, LeaderboardEntry } from './types';
import { createInitialBoard, getValidMovesForPlayer, applyMove } from './utils/gameLogic';
import { getBestMove } from './utils/ai';
import { Piece } from './components/Piece';
import { saveGame, loadGame } from './services/db';
import { multiplayerService } from './services/multiplayer';
import { authService } from './services/auth';
import { leaderboardService } from './services/leaderboard';
import { playSound } from './utils/audio';
import { AuthModal } from './components/AuthModal';

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
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [players, setPlayers] = useState<{white?: string, black?: string}>({});

  // Leaderboard State
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [scoreUpdateMessage, setScoreUpdateMessage] = useState<string | null>(null);

  // Timer State
  const [timeLeft, setTimeLeft] = useState(TURN_DURATION);
  const timeLeftRef = useRef(timeLeft);
  
  // AI State
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [previewMove, setPreviewMove] = useState<Move | null>(null);

  // Multiplayer State
  const [roomId, setRoomId] = useState<string | null>(null);
  const [myOnlineColor, setMyOnlineColor] = useState<PlayerColor | null>(null);
  
  // Multiplayer Menu Logic
  const [availableRooms, setAvailableRooms] = useState<SerializedGame[]>([]);
  const [isRefreshingRooms, setIsRefreshingRooms] = useState(false);
  const [showCreateRoomForm, setShowCreateRoomForm] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null); // For joining private
  const [joinPasswordInput, setJoinPasswordInput] = useState('');

  // Refs for logic
  const scoreUpdatedRef = useRef(false);

  // --- Initialization ---
  useEffect(() => {
    // 1. Listen for Auth Changes
    const unsubscribeAuth = authService.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      if (currentUser) {
          setNewRoomName(`${currentUser.username}'s Room`);
      }
    });

    const init = async () => {
      // 2. Load Local Game (IndexedDB)
      const savedGame = await loadGame();
      if (savedGame) {
        setBoard(savedGame.board);
        setTurn(savedGame.turn);
        setWinner(savedGame.winner);
        setMustCaptureFrom(savedGame.mustCaptureFrom);
        setGameMode(savedGame.gameMode || 'pvp');
        setHistory(savedGame.history || []);
        setTimeLeft(typeof savedGame.timeLeft === 'number' ? savedGame.timeLeft : TURN_DURATION);
        if (savedGame.players) setPlayers(savedGame.players);
        
        // If we were online, reset to menu because online state needs fresh sync
        if (savedGame.gameMode === 'online') {
            setShowMenu(true);
        } else {
            setShowMenu(false);
        }
      } else {
        setShowMenu(true);
      }
      setIsDataLoaded(true);
    };
    init();

    return () => unsubscribeAuth();
  }, []);

  // --- Auto-Save (Local) ---
  useEffect(() => {
    if (isDataLoaded && gameMode !== 'online') {
      const gameState: SerializedGame = {
        board,
        turn,
        winner,
        mustCaptureFrom,
        gameMode,
        history,
        timeLeft,
        players // Save player names
      };
      saveGame(gameState);
    }
  }, [board, turn, winner, mustCaptureFrom, gameMode, history, isDataLoaded, timeLeft, players]);

  // --- Multiplayer Sync ---
  useEffect(() => {
    if (gameMode === 'online' && roomId) {
        const unsubscribe = multiplayerService.subscribeToRoom(roomId, (remoteState) => {
            // Received update from Firebase
            setBoard(remoteState.board);
            setTurn(remoteState.turn);
            setWinner(remoteState.winner);
            setMustCaptureFrom(remoteState.mustCaptureFrom);
            if (remoteState.players) setPlayers(remoteState.players);
            
            // Sync history if it changed
            if (remoteState.history && remoteState.history.length > history.length) {
                setHistory(remoteState.history);
                playSound('move');
                setTimeLeft(TURN_DURATION);
            }
        });
        return () => unsubscribe();
    }
  }, [gameMode, roomId, history.length]);


  // --- Timer Logic ---
  // Sync timeLeftRef
  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  useEffect(() => {
    if (!isDataLoaded || winner || showMenu || (gameMode === 'pve' && turn === 'black' && !isAiThinking)) {
      return;
    }
    
    const timerId = setInterval(() => {
      setTimeLeft((prevTime) => {
        if (prevTime <= 1) {
          clearInterval(timerId);
          const loser = turn;
          const winner = loser === 'white' ? 'black' : 'white';
          setWinner(winner);
          playSound('win');
          return 0;
        }
        return prevTime - 1;
      });
    }, 1000);

    return () => clearInterval(timerId);
  }, [turn, winner, showMenu, isDataLoaded, gameMode, isAiThinking]);

  // --- Fetch Rooms on Menu Open ---
  useEffect(() => {
    if (showMenu) {
        fetchRooms();
    }
  }, [showMenu]);

  // --- SCORING LOGIC ---
  useEffect(() => {
    // Only update score if: 
    // 1. There is a winner
    // 2. We are online (or we can enable for PvE if logged in, but typically online)
    // 3. User is logged in
    // 4. We haven't updated for this session yet
    if (winner && gameMode === 'online' && user && !scoreUpdatedRef.current) {
        if (winner === 'draw') return;

        scoreUpdatedRef.current = true;
        
        // Determine if I won or lost
        const amIWhite = myOnlineColor === 'white';
        const isWin = (winner === 'white' && amIWhite) || (winner === 'black' && !amIWhite);
        
        const change = isWin ? 45 : -25;
        const currentRating = user.rating || 1000;

        leaderboardService.updateScore(user.id, currentRating, change)
            .then((newRating) => {
                if (newRating !== null) {
                    setUser({ ...user, rating: newRating });
                    setScoreUpdateMessage(isWin ? `Victory! +45 PTS` : `Defeat. -25 PTS`);
                }
            });
    } else if (!winner) {
        // Reset the ref when game restarts
        scoreUpdatedRef.current = false;
        setScoreUpdateMessage(null);
    }
  }, [winner, gameMode, user, myOnlineColor]);


  const fetchRooms = async () => {
      setIsRefreshingRooms(true);
      const rooms = await multiplayerService.getAvailableRooms();
      setAvailableRooms(rooms);
      setIsRefreshingRooms(false);
  };

  const handleOpenLeaderboard = async () => {
      setShowLeaderboard(true);
      const data = await leaderboardService.getLeaderboard();
      setLeaderboard(data);
  };


  // --- Actions ---

  const executeMove = useCallback(async (move: Move) => {
    // 1. Save History
    const newHistory = [...history, {
      board: JSON.parse(JSON.stringify(board)), 
      turn,
      mustCaptureFrom
    }];
    setHistory(newHistory);

    // 2. Apply Move
    const { board: newBoard, turnEnded, mustCaptureFrom: nextMustCaptureFrom, promoted, captured } = applyMove(board, move);

    // 3. Play Sounds (Local immediate feedback)
    if (promoted) playSound('king');
    else playSound(captured ? 'capture' : 'move');

    // 4. Update State
    setBoard(newBoard);
    setLastMove({ from: move.from, to: move.to });
    setMustCaptureFrom(nextMustCaptureFrom);

    let nextTurn = turn;
    let nextTime = timeLeftRef.current; // Use Ref

    if (turnEnded) {
      nextTurn = turn === 'white' ? 'black' : 'white';
      setSelectedPos(null);
      nextTime = TURN_DURATION;
      setTimeLeft(TURN_DURATION);
    } else {
      setSelectedPos(move.to);
    }
    setTurn(nextTurn);

    // 5. Broadcast if Online (Firebase)
    if (gameMode === 'online' && roomId) {
        await multiplayerService.updateGame(roomId, {
            board: newBoard,
            turn: nextTurn,
            winner, 
            mustCaptureFrom: nextMustCaptureFrom,
            gameMode: 'online',
            history: newHistory,
            timeLeft: nextTime,
            roomId,
            players
        });
    }

  }, [board, turn, mustCaptureFrom, gameMode, roomId, history, winner, players]); // Removed timeLeft dependency

  // --- AI Logic Hook ---
  useEffect(() => {
    if (winner || !isDataLoaded || showMenu) return;
    if (gameMode === 'pve' && turn === 'black') {
      let cancelled = false;
      
      const runAiTurn = async () => {
        try {
            setIsAiThinking(true);
            await new Promise(resolve => setTimeout(resolve, 600));
            if (cancelled) return;

            const bestMove = getBestMove(board, 'black', mustCaptureFrom);
            if (!bestMove) {
                // If AI has no moves, player wins
                setWinner('white'); 
                playSound('win');
                setIsAiThinking(false);
                return;
            }

            setPreviewMove(bestMove);
            await new Promise(resolve => setTimeout(resolve, 500));
            if (cancelled) return;

            executeMove(bestMove);
        } catch (error) {
            console.error("AI Error:", error);
            // Fallback: Player wins if AI crashes (prevents hang)
            // setWinner('white'); 
        } finally {
            if (!cancelled) {
                setPreviewMove(null);
                setIsAiThinking(false);
            }
        }
      };
      
      runAiTurn();
      
      return () => { cancelled = true; };
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

    if (mustCaptureFrom) {
      setSelectedPos(mustCaptureFrom);
    } else if (selectedPos) {
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
    if (gameMode === 'pve' && turn === 'black') return;
    
    // Online Turn Check
    if (gameMode === 'online') {
        if (turn !== myOnlineColor) return; // Not your turn
    }

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
        return; 
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
    if (gameMode === 'online') return; // No undo in online for now
    if (history.length === 0) return;
    if (winner) setWinner(null);
    
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
        setTimeLeft(TURN_DURATION);
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
    setTimeLeft(TURN_DURATION);
    setRoomId(null);
    setMyOnlineColor(null);
    setShowCreateRoomForm(false);
    setScoreUpdateMessage(null);
    
    // Set initial players
    if (mode === 'pve') {
        setPlayers({ white: user ? user.username : 'Player', black: 'AI Bot' });
    } else if (mode === 'pvp') {
        setPlayers({ white: 'Player 1', black: 'Player 2' });
    } else {
        setPlayers({});
    }
    
    playSound('start');
  };

  const handleCreateRoomSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const newRoomId = multiplayerService.createRoomId();
      const initialState: SerializedGame = {
          board: createInitialBoard(),
          turn: 'white',
          winner: null,
          mustCaptureFrom: null,
          gameMode: 'online',
          history: [],
          timeLeft: TURN_DURATION
      };
      
      const creatorName = user ? user.username : 'Player 1';
      const finalRoomName = newRoomName.trim() || `${creatorName}'s Room`;
      
      const success = await multiplayerService.createRoom(
          newRoomId, 
          initialState, 
          creatorName,
          finalRoomName,
          newRoomPassword
      );

      if (success) {
          setRoomId(newRoomId);
          setMyOnlineColor('white'); // Creator is White
          setGameMode('online');
          // Reset game state
          setBoard(initialState.board);
          setTurn('white');
          setWinner(null);
          setMustCaptureFrom(null);
          setHistory([]);
          setPlayers({ white: creatorName, black: undefined });
          setShowMenu(false);
          setShowCreateRoomForm(false);
          setNewRoomPassword('');
          setScoreUpdateMessage(null);
          playSound('start');
      } else {
          alert("Error creating room. Please try again.");
      }
  };

  const handleJoinClick = (room: SerializedGame) => {
      if (room.isPrivate) {
          setSelectedRoomId(room.roomId || null);
          setJoinPasswordInput('');
      } else {
          // Direct join
          performJoin(room.roomId!, room.password);
      }
  };

  const handlePrivateJoinSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedRoomId) return;
      
      // Find the room
      const room = availableRooms.find(r => r.roomId === selectedRoomId);
      if (!room) return;

      if (room.password === joinPasswordInput) {
          performJoin(room.roomId!, room.password);
          setSelectedRoomId(null);
      } else {
          alert("Incorrect Password");
      }
  };

  const performJoin = async (id: string, password?: string) => {
      const joinerName = user ? user.username : 'Player 2';
      const game = await multiplayerService.joinRoom(id, joinerName);
      if (game) {
          // Double check if password matches (if concurrent update or extra safety)
          if (game.isPrivate && game.password !== password && password !== joinPasswordInput) {
             // Should not happen if filtered correctly
             return; 
          }

          setRoomId(id);
          setMyOnlineColor('black'); // Joiner is Black
          setGameMode('online');
          
          setBoard(game.board);
          setTurn(game.turn);
          setWinner(game.winner);
          setMustCaptureFrom(game.mustCaptureFrom);
          setHistory(game.history);
          if (game.players) setPlayers(game.players);
          
          setShowMenu(false);
          setScoreUpdateMessage(null);
          playSound('start');
      } else {
          alert("Room not found or network error.");
      }
  };

  const handleLogin = (u: User) => {
    setUser(u);
    setNewRoomName(`${u.username}'s Room`);
  };
  
  const handleLogout = () => {
    authService.signOut();
    setUser(null);
    setNewRoomName("Player's Room");
    setShowMenu(true);
  };

  // --- Render Helpers ---
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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

  const getPlayerName = (color: PlayerColor) => {
      if (color === 'white') return players.white || 'White';
      if (color === 'black') return players.black || (gameMode === 'pve' ? 'AI Bot' : 'Black');
      return 'Player';
  };

  if (!isDataLoaded) return <div className="fixed inset-0 flex items-center justify-center bg-slate-900 text-white font-bold">Loading...</div>;

  return (
    <div className="min-h-[100dvh] bg-slate-900 flex flex-col text-slate-100">
      
      {/* HEADER */}
      <header className="flex-none bg-slate-800/80 backdrop-blur border-b border-slate-700 z-30 shadow-md">
        <div className="max-w-4xl mx-auto w-full px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">Dama</h1>
                <div className="hidden sm:flex text-xs text-slate-400 gap-2 items-center border-l border-slate-600 pl-3">
                    <span className="bg-slate-700 px-2 py-0.5 rounded text-slate-200">
                        {gameMode === 'pve' ? 'vs AI' : (gameMode === 'online' ? `Online: ${roomId}` : '2 Player')}
                    </span>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                {/* User Profile */}
                <div className="hidden md:flex items-center gap-2 mr-2">
                    {user ? (
                        <div className="flex items-center gap-2 px-2 py-1 rounded bg-slate-700/50 border border-slate-600">
                             <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-[10px] font-bold text-white">
                                {user.username[0].toUpperCase()}
                             </div>
                             <div className="flex flex-col">
                                <span className="text-xs font-bold leading-none">{user.username}</span>
                                <span className="text-[10px] text-amber-400 font-mono leading-none">{user.rating || 1000}</span>
                             </div>
                             <button onClick={handleLogout} className="text-xs text-slate-400 hover:text-white ml-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                             </button>
                        </div>
                    ) : (
                        <button 
                            onClick={() => setShowAuthModal(true)}
                            className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-full font-bold transition-colors"
                        >
                            Sign In
                        </button>
                    )}
                </div>

                {/* TIMER */}
                <div className={`px-2 md:px-3 py-1 rounded-lg font-mono font-bold text-sm md:text-base border ${timeLeft < 10 ? 'text-red-400 border-red-500/50 animate-pulse' : 'text-slate-200 border-slate-600'}`}>
                   {formatTime(timeLeft)}
                </div>

                {/* Turn Indicator */}
                <div className={`px-3 py-1 rounded-full font-bold shadow-sm flex items-center gap-2 text-xs md:text-sm transition-colors ${turn === 'white' ? 'bg-slate-100 text-slate-900' : 'bg-slate-700 text-slate-100 border border-slate-600'}`}>
                    <div className={`w-2 h-2 rounded-full ${turn === 'white' ? 'bg-slate-900' : 'bg-slate-100'}`}></div>
                    <span className="max-w-[80px] truncate">
                      {winner ? "Game Over" : (gameMode === 'pve' && turn === 'black' ? 'Thinking...' : getPlayerName(turn))}
                    </span>
                </div>
                <button onClick={() => setShowRules(true)} className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-700 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                </button>
            </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        
        {/* Player Names Display for Large Screens */}
        <div className="w-full max-w-lg flex justify-between mb-2 px-2 text-sm font-bold text-slate-400">
             <div className={`flex items-center gap-2 ${turn === 'black' ? 'text-amber-400' : ''}`}>
                 <div className="w-3 h-3 bg-slate-100 rounded-full"></div>
                 {getPlayerName('black')}
             </div>
        </div>

        {/* Board Container */}
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
                        {isValidTarget && (
                        <div className="absolute w-[30%] h-[30%] rounded-full bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.6)] z-20 pointer-events-none animate-pulse" />
                        )}
                        {c === 0 && r === 7 && <span className="absolute bottom-0.5 left-1 text-[8px] sm:text-[10px] text-slate-500 font-mono select-none">A1</span>}
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
            
            {/* Turn Indicator for Online Play */}
            {gameMode === 'online' && !winner && (
                 <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-slate-900/80 backdrop-blur rounded-full text-xs text-white border border-slate-700 shadow-lg z-30 pointer-events-none">
                     {turn === myOnlineColor ? "Your Turn" : `${getPlayerName(turn)}'s Turn`}
                 </div>
            )}

            {/* Overlays (Winner / Menu) */}
            {(winner || showMenu) && (
                <div className="absolute inset-0 z-50 bg-slate-900/95 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
                    <div className="w-full max-w-sm flex flex-col gap-4 animate-in fade-in zoom-in duration-300 py-10">
                        <div className="text-center mb-2">
                            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-1">
                                {showMenu ? "Filipino Dama" : (winner === 'draw' ? 'Draw!' : `${getPlayerName(winner === 'white' ? 'white' : 'black')} Wins!`)}
                            </h2>
                            <p className="text-slate-400 text-sm">
                                {showMenu ? (user ? `Welcome back, ${user.username}` : "Classic Flying Kings Rules") : (timeLeft === 0 ? "Time Out!" : (gameMode === 'pve' && winner === 'white' ? "Victory!" : "Game Over"))}
                            </p>
                            {scoreUpdateMessage && (
                                <div className={`mt-2 font-bold animate-pulse ${scoreUpdateMessage.includes('+') ? 'text-green-400' : 'text-red-400'}`}>
                                    {scoreUpdateMessage}
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-3">
                            {showMenu ? (
                                <>
                                    {!user && (
                                         <button onClick={() => setShowAuthModal(true)} className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white rounded-xl text-sm font-bold mb-2">
                                            Sign In / Sign Up
                                         </button>
                                    )}

                                    {/* Default Menu View */}
                                    {!showCreateRoomForm ? (
                                        <>
                                            <button onClick={() => startNewGame('pve')} className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2">
                                                <span>Single Player</span>
                                                <span className="text-amber-200 text-xs font-normal">(vs AI)</span>
                                            </button>
                                            <button onClick={() => startNewGame('pvp')} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95">
                                                Local Multiplayer
                                            </button>
                                            
                                            <button 
                                                onClick={handleOpenLeaderboard}
                                                className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-amber-500 font-bold rounded-xl shadow transition-colors flex items-center justify-center gap-2"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2h-6c-1.1 0-2 .9-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4c0-1.1-.9-2-2-2Z"></path></svg>
                                                Leaderboard
                                            </button>

                                            {/* Online Section - LOBBY */}
                                            <div className="mt-4 pt-4 border-t border-slate-700">
                                                <div className="flex justify-between items-center mb-3">
                                                    <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Online Lobby</p>
                                                    <button onClick={fetchRooms} className="text-xs text-amber-500 hover:text-amber-400">
                                                        {isRefreshingRooms ? 'Refreshing...' : 'Refresh'}
                                                    </button>
                                                </div>

                                                <button onClick={() => setShowCreateRoomForm(true)} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg mb-3 flex items-center justify-center gap-2">
                                                    <span>Create Room</span>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                                </button>

                                                {/* Room List */}
                                                <div className="bg-slate-800/50 rounded-xl border border-slate-700 max-h-48 overflow-y-auto">
                                                    {availableRooms.length === 0 ? (
                                                        <div className="p-4 text-center text-slate-500 text-sm">
                                                            No active rooms found.<br/>Create one to play!
                                                        </div>
                                                    ) : (
                                                        <ul className="divide-y divide-slate-700">
                                                            {availableRooms.map((room) => (
                                                                <li key={room.roomId} className="p-3 hover:bg-slate-700/50 transition-colors flex justify-between items-center cursor-pointer group" onClick={() => handleJoinClick(room)}>
                                                                    <div className="flex flex-col">
                                                                        <span className="text-sm font-bold text-slate-200 group-hover:text-white flex items-center gap-2">
                                                                            {room.roomName}
                                                                            {room.isPrivate && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>}
                                                                        </span>
                                                                        <span className="text-[10px] text-slate-500">Host: {room.players?.white || 'Unknown'}</span>
                                                                    </div>
                                                                    <div className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-400 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                                                                        Join
                                                                    </div>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        /* CREATE ROOM FORM */
                                        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                                            <h3 className="text-white font-bold mb-4">Create New Room</h3>
                                            <form onSubmit={handleCreateRoomSubmit} className="space-y-3">
                                                <div>
                                                    <label className="text-xs text-slate-400 font-bold uppercase">Room Name</label>
                                                    <input 
                                                        type="text" 
                                                        value={newRoomName}
                                                        onChange={(e) => setNewRoomName(e.target.value)}
                                                        className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                                                        placeholder="e.g. Awesome Game"
                                                        maxLength={20}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-slate-400 font-bold uppercase flex justify-between">
                                                        <span>Password (Optional)</span>
                                                        <span className="text-[10px] text-slate-500 font-normal">Leave empty for public</span>
                                                    </label>
                                                    <input 
                                                        type="text" 
                                                        value={newRoomPassword}
                                                        onChange={(e) => setNewRoomPassword(e.target.value)}
                                                        className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                                                        placeholder="Secret Code"
                                                        maxLength={10}
                                                    />
                                                </div>
                                                <div className="flex gap-2 pt-2">
                                                    <button type="button" onClick={() => setShowCreateRoomForm(false)} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-bold">
                                                        Cancel
                                                    </button>
                                                    <button type="submit" className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold">
                                                        Create
                                                    </button>
                                                </div>
                                            </form>
                                        </div>
                                    )}

                                    {history.length > 0 && gameMode !== 'online' && !showCreateRoomForm && (
                                        <button onClick={() => setShowMenu(false)} className="mt-2 text-slate-400 text-sm hover:text-white underline">Resume Game</button>
                                    )}
                                    
                                    {user && !showCreateRoomForm && (
                                        <button onClick={handleLogout} className="mt-4 text-slate-500 hover:text-slate-400 text-xs font-bold">Log Out</button>
                                    )}
                                </>
                            ) : (
                                <>
                                    <button onClick={() => setShowMenu(true)} className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95">
                                        Play Again
                                    </button>
                                    {gameMode !== 'online' && (
                                        <button onClick={handleUndo} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl shadow-lg">
                                            Undo Last Move
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Password Modal for Joining Private Room */}
            {selectedRoomId && (
                 <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-slate-800 rounded-xl p-5 w-full max-w-xs border border-slate-700 shadow-2xl animate-in zoom-in duration-200">
                        <h3 className="text-white font-bold mb-1">Private Room</h3>
                        <p className="text-xs text-slate-400 mb-4">This room requires a password.</p>
                        <form onSubmit={handlePrivateJoinSubmit}>
                            <input 
                                type="text"
                                autoFocus
                                value={joinPasswordInput}
                                onChange={(e) => setJoinPasswordInput(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-amber-500"
                                placeholder="Enter Password"
                            />
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setSelectedRoomId(null)} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-bold">Cancel</button>
                                <button type="submit" className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm font-bold">Join</button>
                            </div>
                        </form>
                    </div>
                 </div>
            )}

            {/* Leaderboard Modal */}
            {showLeaderboard && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setShowLeaderboard(false)}>
                    <div className="bg-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-700 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2h-6c-1.1 0-2 .9-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4c0-1.1-.9-2-2-2Z"></path></svg>
                                Leaderboard
                            </h3>
                            <button onClick={() => setShowLeaderboard(false)} className="text-slate-400 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto pr-2">
                            {leaderboard.length === 0 ? (
                                <p className="text-center text-slate-500 py-8">No records yet.</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="text-xs text-slate-500 font-bold uppercase border-b border-slate-700">
                                        <tr>
                                            <th className="px-2 py-2 text-left">Rank</th>
                                            <th className="px-2 py-2 text-left">Player</th>
                                            <th className="px-2 py-2 text-right">Rating</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/50">
                                        {leaderboard.map((entry) => (
                                            <tr key={entry.id} className={`${user?.id === entry.id ? 'bg-amber-500/10' : ''}`}>
                                                <td className="px-2 py-3">
                                                    {entry.rank === 1 && <span className="text-amber-400 font-bold">#1</span>}
                                                    {entry.rank === 2 && <span className="text-slate-300 font-bold">#2</span>}
                                                    {entry.rank === 3 && <span className="text-amber-700 font-bold">#3</span>}
                                                    {entry.rank! > 3 && <span className="text-slate-500 font-mono">{entry.rank}</span>}
                                                </td>
                                                <td className={`px-2 py-3 font-medium ${user?.id === entry.id ? 'text-amber-400' : 'text-slate-300'}`}>
                                                    {entry.username}
                                                </td>
                                                <td className="px-2 py-3 text-right text-slate-400 font-mono">
                                                    {entry.rating}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        
                        <div className="mt-4 pt-3 border-t border-slate-700 text-center">
                            <p className="text-xs text-slate-500">
                                Win: <span className="text-green-500 font-bold">+45</span> • Loss: <span className="text-red-500 font-bold">-25</span>
                            </p>
                        </div>
                    </div>
                </div>
            )}

        </div>
        
        {/* Player Names Display for Large Screens - Bottom */}
         <div className="w-full max-w-lg flex justify-between mt-2 px-2 text-sm font-bold text-slate-400">
             <div className={`flex items-center gap-2 ${turn === 'white' ? 'text-amber-400' : ''}`}>
                 <div className="w-3 h-3 bg-slate-900 border border-slate-500 rounded-full"></div>
                 {getPlayerName('white')}
             </div>
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
                
                {gameMode === 'online' ? (
                     <div className="flex flex-col items-end">
                         <span className="text-[10px] text-slate-400 uppercase tracking-widest">Room Name</span>
                         <span className="text-sm font-bold text-indigo-400 tracking-wider">
                            {/* Find current room name from available list or default */}
                            {availableRooms.find(r => r.roomId === roomId)?.roomName || 'Online Game'}
                         </span>
                     </div>
                ) : (
                    <button 
                        onClick={handleUndo}
                        disabled={history.length === 0 || (gameMode === 'pve' && turn === 'black')}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-bold rounded-lg transition-colors shadow-sm"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74-2.74L3 12" /><path d="M3 3v9h9" /></svg>
                        Undo
                    </button>
                )}
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
                    <li><strong>Timer:</strong> {TURN_DURATION} seconds per turn.</li>
                    <li><strong>Online:</strong> Share the 4-digit code to play with a friend.</li>
                </ul>
                <button onClick={() => setShowRules(false)} className="w-full mt-6 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-colors">Close</button>
            </div>
        </div>
      )}
      
      {/* Auth Modal */}
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)}
        onLoginSuccess={handleLogin}
      />
    </div>
  );
};

export default App;