export const BOARD_SIZE = 8;

// Initial Setup for Filipino Dama (12 pieces each)
// Rows 0-2: Black, Rows 5-7: White. Only dark squares.
export const INITIAL_BOARD_LAYOUT = [
  [0, 1, 0, 1, 0, 1, 0, 1], // Row 0 (Black)
  [1, 0, 1, 0, 1, 0, 1, 0], // Row 1 (Black)
  [0, 1, 0, 1, 0, 1, 0, 1], // Row 2 (Black)
  [0, 0, 0, 0, 0, 0, 0, 0], // Row 3 (Empty)
  [0, 0, 0, 0, 0, 0, 0, 0], // Row 4 (Empty)
  [1, 0, 1, 0, 1, 0, 1, 0], // Row 5 (White)
  [0, 1, 0, 1, 0, 1, 0, 1], // Row 6 (White)
  [1, 0, 1, 0, 1, 0, 1, 0], // Row 7 (White)
];

export const TURN_DURATION = 30; // Seconds per turn

// Colors used for styling
export const COLORS = {
  boardLight: 'bg-amber-100',
  boardDark: 'bg-amber-800',
  highlight: 'ring-4 ring-yellow-400',
  validMove: 'bg-green-500/50',
  lastMove: 'bg-blue-500/30',
  text: 'text-slate-100'
};