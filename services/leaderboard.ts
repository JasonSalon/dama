import { supabase } from './supabase';
import { LeaderboardEntry } from '../types';

export const leaderboardService = {
  
  getLeaderboard: async (): Promise<LeaderboardEntry[]> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, rating')
      .order('rating', { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching leaderboard:", JSON.stringify(error, null, 2));
      return [];
    }

    return (data || []).map((entry, index) => ({
      id: entry.id,
      username: entry.username,
      rating: entry.rating,
      rank: index + 1
    }));
  },

  updateScore: async (userId: string, currentRating: number, change: number): Promise<number | null> => {
    const newRating = currentRating + change;
    
    // We handle the update optimistically or directly
    const { data, error } = await supabase
      .from('profiles')
      .update({ rating: newRating })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating score:", JSON.stringify(error, null, 2));
      return null;
    }
    
    return data ? data.rating : newRating;
  }
};