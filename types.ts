export type PlayerColor = 'white' | 'black';
export type GameMode = 'pvp' | 'pve' | 'online';

export interface User {
  id: string;
  username: string;
  rating?: number;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  rating: number;
  rank?: number;
}

export interface Position {
  row: number;
  col: number;
}

export interface Piece {
  color: PlayerColor;
  isKing: boolean;
}

export type BoardState = (Piece | null)[][];

export interface Move {
  from: Position;
  to: Position;
  captures: Position[]; // Positions of pieces captured in this specific move step
  isPromotion?: boolean;
}

export interface MoveResult {
  board: BoardState;
  turnEnded: boolean;
  mustCaptureFrom: Position | null;
  promoted: boolean;
  captured: boolean;
}

export interface GameState {
  board: BoardState;
  turn: PlayerColor;
  winner: PlayerColor | 'draw' | null;
  selectedPos: Position | null;
  validMoves: Move[];
  mustCaptureFrom: Position | null; // If a player is in a multi-jump sequence
}

export interface HistoryState {
  board: BoardState;
  turn: PlayerColor;
  mustCaptureFrom: Position | null;
}

export interface SerializedGame {
  board: BoardState;
  turn: PlayerColor;
  winner: PlayerColor | 'draw' | null;
  mustCaptureFrom: Position | null;
  gameMode: GameMode;
  history: HistoryState[];
  timeLeft: number;
  roomId?: string; // For online play
  roomName?: string; // Display name for the room
  isPrivate?: boolean; // If true, requires password
  password?: string; // stored in state for simplicity in this demo
  lastUpdated?: number; // Timestamp for sync
  players?: {
    white?: string;
    black?: string;
  };
}