import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Play, Square } from 'lucide-react';
import { JARVIS_STATE_LABELS, JarvisState } from './types/chat';
import { checkServerHealth } from './services/geminiClientService';
import { VoiceSessionManager } from './services/voiceSessionManager';
import { JarvisCore } from './components/JarvisCore';

export default function App() {
  const [state, setState] = useState<JarvisState>('IDLE');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [caption, setCaption] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const sessionManagerRef = useRef<VoiceSessionManager | null>(null);

  useEffect(() => {
    const manager = new VoiceSessionManager({
      onStateChange: (nextState) => setState(nextState),
      onAudioLevelChange: (lvl) => setAudioLevel(lvl),
      onCaptionChange: (text) => setCaption(text),
      onErrorChange: (err) => setErrorMessage(err),
    });

    manager.init();
    sessionManagerRef.current = manager;

    // Verify server API configuration on startup
    checkServerHealth()
      .then((health) => {
        if (!health.configured) {
          setErrorMessage(
            'GEMINI_API_KEY is missing on the server. Configure GEMINI_API_KEY in Settings > Secrets.'
          );
          setState('ERROR');
        }
      })
      .catch(() => {
        // Ignore initial health check transient error until user starts session
      });

    return () => {
      manager.destroy();
      sessionManagerRef.current = null;
    };
  }, []);

  const handleStartOrInterrupt = useCallback(() => {
    sessionManagerRef.current?.startOrInterruptSession();
  }, []);

  const handleStop = useCallback(() => {
    sessionManagerRef.current?.stopSession();
  }, []);

  const isActive =
    state === 'LISTENING' ||
    state === 'THINKING' ||
    state === 'SPEAKING' ||
    state === 'RECONNECTING';

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-[#02050B] text-slate-100 flex flex-col items-center justify-center px-6 select-none">
      {/* Subtle radial atmospheric depth */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.08)_0%,rgba(2,5,11,0)_65%)]"
        aria-hidden="true"
      />

      {/* Central Animated JARVIS Core */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        <JarvisCore
          state={state}
          audioLevel={audioLevel}
          onActivate={handleStartOrInterrupt}
        />

        {/* Minimal State Indicator & Microphone Status Beneath the Core */}
        <div className="mt-8 flex flex-col items-center text-center max-w-lg">
          <div className="flex items-center gap-2.5">
            {state === 'LISTENING' ? (
              <Mic
                className="w-4 h-4 text-sky-300 transition-colors"
                aria-label="Microphone listening"
              />
            ) : (
              <MicOff
                className="w-4 h-4 text-cyan-500/50 transition-colors"
                aria-label="Microphone standby"
              />
            )}
            <span
              className={`font-display text-sm sm:text-base font-semibold tracking-[0.22em] ${
                state === 'ERROR'
                  ? 'text-amber-400'
                  : state === 'SPEAKING'
                  ? 'text-cyan-200'
                  : state === 'LISTENING'
                  ? 'text-sky-300'
                  : 'text-cyan-400/90'
              }`}
              role="status"
              aria-live="polite"
            >
              {JARVIS_STATE_LABELS[state]}
            </span>
          </div>

          {/* Optional Transcript Caption or Error Feedback */}
          <div className="mt-3 min-h-[3.5rem] flex items-center justify-center px-2">
            {errorMessage ? (
              <p className="text-xs sm:text-sm text-amber-300/90 leading-relaxed max-w-md">
                {errorMessage}
              </p>
            ) : caption ? (
              <p className="text-xs sm:text-sm text-cyan-100/80 leading-relaxed line-clamp-2 max-w-md font-normal">
                {caption}
              </p>
            ) : (
              <p className="text-xs text-cyan-500/55 tracking-wide">
                {state === 'IDLE'
                  ? 'Click Start JARVIS or tap the core once to unlock audio and begin speaking'
                  : state === 'SPEAKING'
                  ? 'Tap the core at any time to interrupt and ask a new question'
                  : ''}
              </p>
            )}
          </div>

          {/* Single Start / Stop Control */}
          <div className="mt-4 h-10 flex items-center justify-center">
            {isActive ? (
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-cyan-500/35 bg-cyan-950/40 hover:bg-cyan-900/50 hover:border-cyan-400/70 text-xs font-semibold tracking-wider text-cyan-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap"
                aria-label="Stop JARVIS session"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>STOP JARVIS</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartOrInterrupt}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-cyan-400/50 bg-cyan-500/15 hover:bg-cyan-500/25 hover:border-cyan-300 text-xs font-semibold tracking-wider text-cyan-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap"
                aria-label="Start JARVIS voice session"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>START JARVIS</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
