export type PlayerColor = 'white' | 'black';

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

export interface GameState {
  board: BoardState;
  turn: PlayerColor;
  winner: PlayerColor | 'draw' | null;
  selectedPos: Position | null;
  validMoves: Move[];
  mustCaptureFrom: Position | null; // If a player is in a multi-jump sequence
}

export interface SerializedGame {
  board: BoardState;
  turn: PlayerColor;
  winner: PlayerColor | 'draw' | null;
  mustCaptureFrom: Position | null;
}