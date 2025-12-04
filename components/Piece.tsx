import React from 'react';
import { Piece as PieceType } from '../types';

interface PieceProps {
  piece: PieceType;
}

export const Piece: React.FC<PieceProps> = ({ piece }) => {
  const isWhite = piece.color === 'white';
  
  return (
    <div
      className={`
        w-[80%] aspect-square rounded-full shadow-lg flex items-center justify-center transition-transform duration-200
        ${isWhite 
          ? 'bg-slate-100 border-4 border-slate-300 shadow-slate-900/20' 
          : 'bg-slate-800 border-4 border-slate-600 shadow-black/40'}
      `}
    >
      {/* Inner ring for detail */}
      <div className={`w-[70%] h-[70%] rounded-full border-2 ${isWhite ? 'border-slate-300' : 'border-slate-600'} flex items-center justify-center`}>
        {piece.isKing && (
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 24 24" 
            fill="currentColor" 
            className={`w-3/4 h-3/4 ${isWhite ? 'text-amber-500' : 'text-amber-400'}`}
          >
            <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    </div>
  );
};