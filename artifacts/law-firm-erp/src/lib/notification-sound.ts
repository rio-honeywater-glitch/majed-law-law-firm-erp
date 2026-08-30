/**
 * Plays a distinctive 3-tone chime using the Web Audio API.
 * No external audio file needed — works offline and across all modern browsers.
 * Uses a D-major arpeggio (D5 → F#5 → A5) — pleasant and recognisable.
 *
 * Safe to call from service-worker message handlers (no user-gesture context):
 * we call ctx.resume() before scheduling notes, which handles the auto-suspended state.
 * If the browser blocks audio entirely (policy), we fall back silently.
 */
export function playNotificationSound(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const scheduleNotes = () => {
      // Three ascending tones: D5 → F#5 → A5
      const notes = [587.33, 739.99, 880.0];
      const startTime = ctx.currentTime;

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, startTime);

        const noteStart = startTime + i * 0.18;
        const noteEnd = noteStart + 0.28;

        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(0.5, noteStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, noteEnd);

        osc.start(noteStart);
        osc.stop(noteEnd);
      });

      // Auto-close AudioContext after last note
      setTimeout(() => ctx.close(), 900);
    };

    if (ctx.state === "suspended") {
      // Resume (may be blocked by autoplay policy if no prior user interaction)
      ctx.resume().then(scheduleNotes).catch(() => ctx.close());
    } else {
      scheduleNotes();
    }
  } catch {
    // Silently ignore — sound is optional
  }
}
