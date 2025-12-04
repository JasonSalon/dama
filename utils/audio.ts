// Simple Audio Synthesizer for game effects
// Using Web Audio API to avoid external dependencies

let audioCtx: AudioContext | null = null;

const initAudio = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

type SoundType = 'move' | 'capture' | 'king' | 'win' | 'start';

export const playSound = (type: SoundType) => {
  try {
    const ctx = initAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    switch (type) {
      case 'move':
        // Soft click/thud
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
        break;

      case 'capture':
        // Zappy laser sound
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
        break;

      case 'king':
        // Rising magical chime
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(800, now + 0.2);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
        break;
        
      case 'start':
        // Gentle chord
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
        break;

      case 'win':
        // Victory Arpeggio
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major
        notes.forEach((freq, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'square';
            o.connect(g);
            g.connect(ctx.destination);
            
            const start = now + (i * 0.1);
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.1, start);
            g.gain.exponentialRampToValueAtTime(0.01, start + 0.4);
            o.start(start);
            o.stop(start + 0.4);
        });
        break;
    }
  } catch (e) {
    // Audio context might be blocked or not supported
    console.warn("Audio play failed", e);
  }
};