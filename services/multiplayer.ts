import { supabase } from './supabase';
import { SerializedGame } from '../types';

export const multiplayerService = {
  // Generate a random 4-digit room code
  createRoomId: (): string => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  },

  // Initialize a room in Supabase 'rooms' table
  createRoom: async (
    roomId: string, 
    initialState: SerializedGame, 
    creatorName?: string,
    roomName?: string,
    password?: string
  ): Promise<boolean> => {
    const gameData: SerializedGame = {
      ...initialState,
      roomId,
      roomName: roomName || `${creatorName || 'Player'}'s Room`,
      isPrivate: !!password,
      password: password || undefined,
      lastUpdated: Date.now(),
      players: {
        white: creatorName || 'Player 1',
        black: undefined
      }
    };

    const { error } = await supabase
      .from('rooms')
      .insert({ 
        room_id: roomId, 
        state: gameData 
      });

    if (error) {
      console.error("Supabase create error:", error);
      return false;
    }
    return true;
  },

  // Get list of active rooms that are not full (or all rooms)
  getAvailableRooms: async (): Promise<SerializedGame[]> => {
    // Fetch last 50 created rooms
    const { data, error } = await supabase
      .from('rooms')
      .select('state')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data) {
        console.error("Error fetching rooms", error);
        return [];
    }

    // Filter and map in client side
    // We only want rooms where the game isn't over and black player hasn't joined yet
    const rooms = data
        .map(row => row.state as SerializedGame)
        .filter(game => {
            // Filter out finished games or games where player 2 is already there
            const isFull = !!game.players?.black;
            const isOver = !!game.winner;
            // Also ensure it's a valid game object
            return !isFull && !isOver && game.gameMode === 'online';
        });

    return rooms;
  },

  // Join a room
  joinRoom: async (roomId: string, joinerName?: string): Promise<SerializedGame | null> => {
    // 1. Fetch current room state
    const { data, error } = await supabase
      .from('rooms')
      .select('state')
      .eq('room_id', roomId)
      .single();

    if (error || !data) {
      console.error("Supabase join error:", error);
      return null;
    }

    const game = data.state as SerializedGame;

    // 2. Update player 2 name if needed
    let needsUpdate = false;
    if (joinerName) {
        if (game.players && !game.players.black) {
            game.players.black = joinerName;
            needsUpdate = true;
        } else if (!game.players) {
            game.players = { white: 'Player 1', black: joinerName };
            needsUpdate = true;
        }
    }

    if (needsUpdate) {
        game.lastUpdated = Date.now();
        await supabase
            .from('rooms')
            .update({ state: game })
            .eq('room_id', roomId);
    }

    return game;
  },

  // Update game state
  updateGame: async (roomId: string, gameState: SerializedGame): Promise<void> => {
    const updatedState = {
        ...gameState,
        lastUpdated: Date.now()
    };
    
    await supabase
      .from('rooms')
      .update({ state: updatedState })
      .eq('room_id', roomId);
  },

  // Subscribe to room updates via Realtime
  subscribeToRoom: (roomId: string, onUpdate: (game: SerializedGame) => void) => {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'rooms', 
          filter: `room_id=eq.${roomId}` 
        },
        (payload) => {
          if (payload.new && payload.new.state) {
            onUpdate(payload.new.state as SerializedGame);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
};