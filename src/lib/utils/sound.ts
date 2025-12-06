// Audio utility for playing notification sounds

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * Plays a pleasant completion chime using Web Audio API
 * Creates a simple two-tone "ding-dong" sound
 */
export function playCompletionSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Create a pleasant two-note chime
    const frequencies = [523.25, 659.25]; // C5 and E5
    const duration = 0.15;
    const gap = 0.1;

    frequencies.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, now);

      const startTime = now + i * (duration + gap);

      // Envelope: quick attack, gradual decay
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    });
  } catch (error) {
    console.warn('Failed to play completion sound:', error);
  }
}

/**
 * Plays a quick confirmation sound when a repo is selected
 * Creates a short ascending two-note "boop-beep" sound
 */
export function playRepoSelectedSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Create a quick ascending two-note sound (different from completion)
    const frequencies = [392.00, 523.25]; // G4 and C5 - ascending
    const duration = 0.08;
    const gap = 0.04;

    frequencies.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, now);

      const startTime = now + i * (duration + gap);

      // Quick envelope
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.25, startTime + 0.005);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    });
  } catch (error) {
    console.warn('Failed to play repo selected sound:', error);
  }
}

/**
 * Plays a distinctive "wake up" sound when open mic detects a wake command
 * Creates an ascending three-note arpeggio to indicate activation
 */
export function playOpenMicTriggerSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Ascending arpeggio: C5 -> E5 -> G5 (major chord)
    const frequencies = [523.25, 659.25, 783.99];
    const duration = 0.1;
    const gap = 0.05;

    frequencies.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, now);

      const startTime = now + i * (duration + gap);

      // Quick attack, smooth decay
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.25, startTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    });
  } catch (error) {
    console.warn('Failed to play open mic trigger sound:', error);
  }
}

/**
 * Plays a confirmation sound when a voice command (like "send it") is detected
 * Creates a quick double-beep to confirm the command was received
 */
export function playVoiceCommandSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Quick double-beep at the same pitch (confirmation sound)
    const frequency = 880; // A5 - higher pitch for distinctiveness
    const duration = 0.06;
    const gap = 0.08;
    const repetitions = 2;

    for (let i = 0; i < repetitions; i++) {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);

      const startTime = now + i * (duration + gap);

      // Quick envelope
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.2, startTime + 0.005);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    }
  } catch (error) {
    console.warn('Failed to play voice command sound:', error);
  }
}
