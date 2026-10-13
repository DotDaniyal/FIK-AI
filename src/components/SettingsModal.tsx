import React from 'react';
import { X, Sliders, Volume2, Globe, ShieldCheck, Trash2 } from 'lucide-react';
import { WORLD_LANGUAGES } from '../types/languages';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLanguage: string;
  onLanguageChange: (lang: string) => void;
  speechRate: number;
  onSpeechRateChange: (rate: number) => void;
  onClearHistory: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  selectedLanguage,
  onLanguageChange,
  speechRate,
  onSpeechRateChange,
  onClearHistory,
}: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg rounded-2xl bg-[#090E1A] border border-cyan-500/25 shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/15 bg-cyan-950/20">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-cyan-400" />
            <h2 className="font-display text-base font-semibold tracking-wider text-cyan-100">
              FIK AI SETTINGS
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          {/* Language Selection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-cyan-200">
              <Globe className="w-4 h-4 text-cyan-400" />
              <span>Spoken & Recognition Language (All World Languages)</span>
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => onLanguageChange(e.target.value)}
              className="w-full bg-[#030712] border border-cyan-500/30 rounded-xl px-4 py-2.5 text-sm text-cyan-100 focus:outline-none focus:border-cyan-400 transition-colors"
            >
              {WORLD_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code} className="bg-[#030712] text-slate-100">
                  {lang.name} ({lang.nativeName})
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400">
              FIK AI will automatically translate and respond fluently in your chosen language.
            </p>
          </div>

          {/* Speech Rate */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-cyan-200">
              <Volume2 className="w-4 h-4 text-cyan-400" />
              <span>Voice Speech Rate: {speechRate}x</span>
            </label>
            <input
              type="range"
              min="0.75"
              max="1.5"
              step="0.05"
              value={speechRate}
              onChange={(e) => onSpeechRateChange(parseFloat(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer bg-slate-800 h-2 rounded-lg"
            />
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>0.75x (Calm)</span>
              <span>1.0x (Normal)</span>
              <span>1.5x (Fast)</span>
            </div>
          </div>

          {/* Conversation History Management */}
          <div className="space-y-2 pt-2 border-t border-cyan-500/15">
            <label className="flex items-center gap-2 text-sm font-medium text-cyan-200">
              <Trash2 className="w-4 h-4 text-amber-400" />
              <span>Conversation Memory</span>
            </label>
            <div className="flex items-center justify-between bg-[#030712] border border-cyan-500/20 rounded-xl p-3">
              <span className="text-xs text-slate-300">Clear active conversation context & history</span>
              <button
                onClick={() => {
                  onClearHistory();
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 transition-colors"
              >
                Clear History
              </button>
            </div>
          </div>

          {/* Privacy & Security Badge */}
          <div className="pt-2 border-t border-cyan-500/15">
            <div className="flex items-start gap-3 bg-cyan-950/25 border border-cyan-500/20 rounded-xl p-3.5">
              <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-cyan-200 uppercase tracking-wider">
                  Secure Enterprise AI
                </h4>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Your voice turns and data are securely processed via server-side Google Gemini proxies. No sensitive keys or unencrypted audio are stored permanently.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-cyan-500/15 bg-cyan-950/20">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/50 text-xs font-semibold tracking-wider text-cyan-200 hover:bg-cyan-500/30 transition-colors"
          >
            SAVE & CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
