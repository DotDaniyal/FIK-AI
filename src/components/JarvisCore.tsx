import React from 'react';
import { JarvisState } from '../types/chat';

interface JarvisCoreProps {
  state: JarvisState;
  audioLevel: number;
  onActivate: () => void;
}

export const JarvisCore: React.FC<JarvisCoreProps> = React.memo(
  ({ state, audioLevel, onActivate }) => {
    const clampedLevel = Math.max(0, Math.min(1, audioLevel));

    const outerRingScale =
      state === 'LISTENING'
        ? 1 + clampedLevel * 0.16
        : state === 'SPEAKING'
        ? 1 + clampedLevel * 0.15
        : 1;

    const innerCoreScale =
      state === 'LISTENING'
        ? 1 + clampedLevel * 0.22
        : state === 'SPEAKING'
        ? 1 + clampedLevel * 0.28
        : 1;

    const isError = state === 'ERROR';
    const isThinking = state === 'THINKING' || state === 'RECONNECTING';
    const isSpeaking = state === 'SPEAKING';
    const isListening = state === 'LISTENING';

    const primaryColorClass = isError
      ? 'text-amber-400'
      : isListening
      ? 'text-sky-300'
      : isSpeaking
      ? 'text-cyan-200'
      : 'text-cyan-400';

    const secondaryColorClass = isError
      ? 'text-amber-500/45'
      : isListening
      ? 'text-sky-400/65'
      : isSpeaking
      ? 'text-cyan-300/75'
      : 'text-cyan-500/45';

    return (
      <button
        type="button"
        onClick={onActivate}
        aria-label={
          state === 'IDLE' || state === 'ERROR'
            ? 'Start FIK AI voice assistant'
            : state === 'SPEAKING'
            ? 'Interrupt FIK AI and speak'
            : `FIK AI state: ${state}`
        }
        className="group relative flex items-center justify-center w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 rounded-full select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 transition-transform duration-300 active:scale-95"
      >
        {/* Ambient radial energy field */}
        <div
          style={{
            transform: `scale(${outerRingScale})`,
            opacity:
              state === 'IDLE'
                ? 0.45
                : isThinking
                ? 0.72
                : 0.65 + clampedLevel * 0.35,
          }}
          className={`absolute inset-4 rounded-full transition-all duration-75 pointer-events-none ${
            isError
              ? 'bg-[radial-gradient(circle,rgba(245,158,11,0.22)_0%,rgba(245,158,11,0.04)_55%,transparent_75%)]'
              : isSpeaking
              ? 'bg-[radial-gradient(circle,rgba(34,211,238,0.34)_0%,rgba(14,165,233,0.10)_55%,transparent_75%)]'
              : isListening
              ? 'bg-[radial-gradient(circle,rgba(56,189,248,0.30)_0%,rgba(6,182,212,0.08)_55%,transparent_75%)]'
              : 'bg-[radial-gradient(circle,rgba(6,182,212,0.20)_0%,rgba(6,182,212,0.04)_55%,transparent_75%)]'
          }`}
        />

        {/* Outermost audio-reactive ring */}
        <svg
          viewBox="0 0 240 240"
          style={{ transform: `scale(${outerRingScale})` }}
          className={`absolute inset-0 w-full h-full transition-transform duration-75 ${secondaryColorClass}`}
        >
          <circle
            cx="120"
            cy="120"
            r="112"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 7"
          />
          <circle
            cx="120"
            cy="120"
            r="104"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="48 16 12 16"
            className="animate-jarvis-spin"
            style={{ transformOrigin: '120px 120px' }}
          />
        </svg>

        {/* Secondary counter-rotating structural ring */}
        <svg
          viewBox="0 0 240 240"
          className={`absolute inset-0 w-full h-full ${primaryColorClass}`}
        >
          <circle
            cx="120"
            cy="120"
            r="88"
            fill="none"
            stroke="currentColor"
            strokeWidth={isThinking ? '2.5' : '1.75'}
            strokeDasharray={isThinking ? '56 28' : '32 14 8 14 18 14'}
            className={isThinking ? 'animate-jarvis-spin-fast' : 'animate-jarvis-reverse'}
            style={{ transformOrigin: '120px 120px' }}
          />
          <circle
            cx="120"
            cy="120"
            r="74"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeDasharray="16 20"
            className="opacity-65 animate-jarvis-spin"
            style={{ transformOrigin: '120px 120px' }}
          />
        </svg>

        {/* Inner rotating energy ring */}
        <svg
          viewBox="0 0 240 240"
          style={{
            transform: `scale(${1 + clampedLevel * 0.1})`,
          }}
          className={`absolute inset-0 w-full h-full transition-transform duration-75 ${primaryColorClass}`}
        >
          <circle
            cx="120"
            cy="120"
            r="58"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeDasharray="24 12 6 12"
            className={
              isThinking || isSpeaking ? 'animate-jarvis-spin-fast' : 'animate-jarvis-spin'
            }
            style={{ transformOrigin: '120px 120px' }}
          />
          <circle
            cx="120"
            cy="120"
            r="46"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="4 4"
            className="opacity-70"
          />
        </svg>

        {/* Central glowing nucleus */}
        <div
          style={{
            transform: `scale(${innerCoreScale})`,
          }}
          className={`relative flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-full transition-transform duration-75 ${
            state === 'IDLE' ? 'animate-jarvis-breathe' : ''
          }`}
        >
          <div
            className={`w-full h-full rounded-full border transition-colors duration-200 ${
              isError
                ? 'border-amber-400/70 bg-amber-400/15 shadow-[0_0_32px_rgba(245,158,11,0.5)]'
                : isSpeaking
                ? 'border-cyan-200 bg-cyan-300/30 shadow-[0_0_45px_rgba(34,211,238,0.85)]'
                : isListening
                ? 'border-sky-300/90 bg-sky-400/20 shadow-[0_0_36px_rgba(56,189,248,0.7)]'
                : isThinking
                ? 'border-cyan-300/85 bg-cyan-400/25 shadow-[0_0_38px_rgba(6,182,212,0.75)]'
                : 'border-cyan-400/60 bg-cyan-500/15 group-hover:border-cyan-300/80 shadow-[0_0_26px_rgba(6,182,212,0.45)]'
            }`}
          />
          <div
            className={`absolute w-7 h-7 sm:w-8 sm:h-8 rounded-full transition-colors duration-200 ${
              isError
                ? 'bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.9)]'
                : isSpeaking
                ? 'bg-white shadow-[0_0_24px_rgba(255,255,255,1)]'
                : 'bg-cyan-200 shadow-[0_0_18px_rgba(165,243,252,0.9)]'
            }`}
          />
        </div>
      </button>
    );
  }
);

JarvisCore.displayName = 'JarvisCore';
