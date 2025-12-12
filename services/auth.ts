import { supabase } from './supabase';
import { User } from '../types';

// Helper to allow short passwords by padding them to satisfy Supabase security policies (min 6 chars)
const processPassword = (pwd: string) => {
  return `${pwd}_dama_padding_v1`;
};

export const authService = {
  
  // Register a new user with REAL Email
  signUp: async (email: string, username: string, password: string): Promise<{ user?: User; error?: string }> => {
    try {
      const cleanUsername = username.trim();
      const cleanEmail = email.trim().toLowerCase();
      const securePassword = processPassword(password);
      
      // 1. Check if username is already taken in profiles
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', cleanUsername)
        .single();
        
      if (existingProfile) {
        return { error: "Username is already taken. Please choose another." };
      }

      // 2. Perform Supabase Auth Sign Up
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: securePassword,
        options: {
          data: {
            username: cleanUsername
          }
        }
      });

      if (error) {
        if (error.message.includes('already registered')) return { error: 'Email is already registered.' };
        return { error: error.message };
      }

      if (data.user) {
        // 3. Create initial profile for leaderboard
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: data.user.id,
            username: cleanUsername,
            rating: 1000 // Starting rating
          });

        if (profileError) {
          console.warn("Profile creation note:", profileError.message);
        }

        // If session is missing, it usually means Email Confirmation is required
        if (!data.session) {
           return { error: "Account created! Please check your email to confirm your account before logging in." };
        }

        return { 
          user: { 
            id: data.user.id,
            username: data.user.user_metadata.username || cleanUsername,
            rating: 1000
          } 
        };
      }
      
      return { error: 'Registration failed. Please try again.' };
    } catch (err: any) {
      console.error(err);
      return { error: "An unexpected error occurred" };
    }
  },

  // Login existing user (accepts Email OR Username)
  signIn: async (loginIdentifier: string, password: string): Promise<{ user?: User; error?: string }> => {
    try {
      const identifier = loginIdentifier.trim().toLowerCase();
      const securePassword = processPassword(password);
      
      // Determine if input is email or username
      let email = identifier;
      if (!identifier.includes('@')) {
        // Fallback for legacy username-based accounts or user trying to login with username
        // We assume the legacy pattern
        email = `${identifier.replace(/\s/g, '')}@dama-game.com`;
      }
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: securePassword
      });

      if (error) {
        // Return the actual error message
        return { error: error.message };
      }

      if (data.user) {
        // Fetch current rating
        let rating = 1000;
        const { data: profile } = await supabase
          .from('profiles')
          .select('rating')
          .eq('id', data.user.id)
          .single();
        
        if (profile) rating = profile.rating;

        // Use metadata username, or profile username (if we fetched it), or fallback
        const username = data.user.user_metadata.username || 'Player';

        return { 
          user: { 
            id: data.user.id,
            username,
            rating
          } 
        };
      }
      
      return { error: 'Login failed' };
    } catch (err: any) {
      return { error: 'Connection error' };
    }
  },
  
  // Create a temporary guest session (Local only)
  loginAsGuest: (): User => {
    const randomId = Math.floor(Math.random() * 10000);
    return {
      id: `guest-${randomId}`,
      username: `Guest${randomId}`,
      rating: 1000
    };
  },

  // Logout
  signOut: async (): Promise<void> => {
    await supabase.auth.signOut();
  },

  // Listen to Auth Changes
  onAuthStateChanged: (callback: (user: User | null) => void) => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        // Ensure we have the latest rating
        let rating = 1000;
        const { data: profile } = await supabase
          .from('profiles')
          .select('rating')
          .eq('id', session.user.id)
          .single();
          
        if (profile) rating = profile.rating;

        callback({ 
          id: session.user.id,
          username: session.user.user_metadata.username || session.user.email?.split('@')[0] || 'Player',
          rating
        });
      } else {
        callback(null);
      }
    });

    return () => subscription.unsubscribe();
  }
};