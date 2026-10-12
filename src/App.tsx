import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Play, Square, Globe } from 'lucide-react';
import { FIK_STATE_LABELS, JarvisState } from './types/chat';
import { WORLD_LANGUAGES } from './types/languages';
import { checkServerHealth } from './services/geminiClientService';
import { VoiceSessionManager } from './services/voiceSessionManager';
import { JarvisCore } from './components/JarvisCore';

export default function App() {
  const [state, setState] = useState<JarvisState>('IDLE');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [caption, setCaption] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('auto');

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

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value;
    setSelectedLanguage(lang);
    sessionManagerRef.current?.setLanguage(lang);
  };

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

      {/* Top Header with World Language Selector */}
      <div className="absolute top-4 left-6 right-6 z-20 flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-display text-xs sm:text-sm font-bold tracking-[0.25em] text-cyan-200">
            FIK AI <span className="text-cyan-400/70 font-normal">FAST & ALL LANGUAGES</span>
          </span>
        </div>

        <div className="flex items-center gap-2 bg-cyan-950/40 border border-cyan-500/30 px-3 py-1.5 rounded-full backdrop-blur-md shadow-lg">
          <Globe className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
          <select
            value={selectedLanguage}
            onChange={handleLanguageChange}
            aria-label="Select world language"
            className="bg-transparent text-xs font-medium text-cyan-100 focus:outline-none cursor-pointer max-w-[180px] sm:max-w-xs truncate"
          >
            {WORLD_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code} className="bg-[#02050B] text-slate-100">
                {lang.name} ({lang.nativeName})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Central Animated FIK AI Core */}
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
              {FIK_STATE_LABELS[state]}
            </span>
          </div>

          {/* Optional Transcript Caption or Error Feedback */}
          <div className="mt-3 min-h-[3.5rem] flex items-center justify-center px-2">
            {errorMessage ? (
              <p className="text-xs sm:text-sm text-amber-300/90 leading-relaxed max-w-lg text-center">
                {errorMessage}
              </p>
            ) : caption ? (
              <p className="text-sm sm:text-base text-cyan-100/95 leading-relaxed max-w-lg text-center max-h-24 overflow-y-auto font-normal px-2 scrollbar-none">
                {caption}
              </p>
            ) : (
              <p className="text-xs text-cyan-500/55 tracking-wide">
                {state === 'IDLE'
                  ? 'Click Start FIK AI or tap the core once to unlock audio and begin speaking'
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
                aria-label="Stop FIK AI session"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>STOP FIK AI</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartOrInterrupt}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-cyan-400/50 bg-cyan-500/15 hover:bg-cyan-500/25 hover:border-cyan-300 text-xs font-semibold tracking-wider text-cyan-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap"
                aria-label="Start FIK AI voice session"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>START FIK AI</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
