import React, { useState, useEffect } from 'react';
import { authService } from '../services/auth';
import { User } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
        setError(null);
        setEmail('');
        setUsername('');
        setPassword('');
        setActiveTab('signup');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (activeTab === 'signup' && (!email || !username || !password)) {
        setError("Please fill in all fields");
        return;
    }
    if (activeTab === 'signin' && (!email || !password)) {
        // In signin mode, 'email' state is used for 'email or username' input
        setError("Please enter your login details");
        return;
    }
    
    setError(null);
    setIsLoading(true);

    try {
      const result = activeTab === 'signup'
        ? await authService.signUp(email, username, password)
        : await authService.signIn(email, password); // reuse 'email' state for login identifier

      if (result.error) {
        setError(result.error);
      } else if (result.user) {
        onLoginSuccess(result.user);
        onClose();
        setEmail('');
        setUsername('');
        setPassword('');
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestLogin = () => {
    const guest = authService.loginAsGuest();
    onLoginSuccess(guest);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-slate-800 rounded-2xl w-full max-w-sm shadow-2xl border border-slate-700 overflow-hidden relative" 
        onClick={e => e.stopPropagation()}
      >
        {/* Tabs */}
        <div className="flex border-b border-slate-700">
            <button 
                onClick={() => { setActiveTab('signup'); setError(null); }}
                className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-colors ${activeTab === 'signup' ? 'bg-amber-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
            >
                Sign Up
            </button>
            <button 
                onClick={() => { setActiveTab('signin'); setError(null); }}
                className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-colors ${activeTab === 'signin' ? 'bg-amber-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
            >
                Sign In
            </button>
        </div>

        <div className="p-6">
            <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-white mb-1">
                {activeTab === 'signup' ? 'Create Account' : 'Welcome Back'}
            </h2>
            <p className="text-slate-400 text-sm">
                {activeTab === 'signup' ? 'Enter your details to join the global leaderboard.' : 'Log in to sync your rating.'}
            </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Email Field (Used as "Email or Username" in Login) */}
            <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                    {activeTab === 'signup' ? 'Email Address' : 'Email or Username'}
                </label>
                <input 
                type={activeTab === 'signup' ? "email" : "text"}
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                placeholder={activeTab === 'signup' ? "you@example.com" : "you@example.com or username"}
                autoComplete={activeTab === 'signup' ? 'email' : 'username'}
                />
            </div>

            {/* Username Field (Sign Up Only) */}
            {activeTab === 'signup' && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Username</label>
                    <input 
                    type="text" 
                    required
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder="Display Name"
                    autoComplete="username"
                    maxLength={15}
                    />
                </div>
            )}
            
            <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Password</label>
                <input 
                type="password" 
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                placeholder="Password"
                />
            </div>

            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm text-center font-medium">
                {error}
                </div>
            )}

            <button 
                type="submit" 
                disabled={isLoading}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95 mt-2"
            >
                {isLoading ? 'Processing...' : (activeTab === 'signup' ? 'Sign Up' : 'Sign In')}
            </button>
            </form>

            <div className="mt-4 pt-4 border-t border-slate-700">
                <button 
                    onClick={handleGuestLogin}
                    className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold rounded-xl text-sm transition-colors"
                >
                    Play as Guest
                </button>
            </div>
        </div>

        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-500 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

      </div>
    </div>
  );
}