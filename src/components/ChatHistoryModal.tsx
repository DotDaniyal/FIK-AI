import React, { useState } from 'react';
import { X, MessageSquare, Send, Copy, Check } from 'lucide-react';
import { VoiceTurn } from '../types/chat';

interface ChatHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  turns: VoiceTurn[];
  onTextSubmit: (text: string) => Promise<void>;
  onClearHistory: () => void;
}

export function ChatHistoryModal({
  isOpen,
  onClose,
  turns,
  onTextSubmit,
  onClearHistory,
}: ChatHistoryModalProps) {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onTextSubmit(inputText.trim());
      setInputText('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#090E1A] border border-cyan-500/25 shadow-2xl overflow-hidden text-slate-100 flex flex-col h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/15 bg-cyan-950/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-5 h-5 text-cyan-400" />
            <h2 className="font-display text-base font-semibold tracking-wider text-cyan-100">
              CONVERSATION TRANSCRIPT & TEXT CHAT
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Close transcripts"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Turns List */}
        <div className="flex-1 p-6 space-y-4 overflow-y-auto custom-scrollbar">
          {turns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 space-y-2">
              <MessageSquare className="w-10 h-10 text-cyan-500/30" />
              <p className="text-sm">No conversation turns yet.</p>
              <p className="text-xs text-slate-500">
                Speak to FIK AI or type a question below to begin chatting.
              </p>
            </div>
          ) : (
            turns.map((turn, index) => {
              const isUser = turn.role === 'user';
              return (
                <div
                  key={index}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-cyan-400/80">
                      {isUser ? 'You' : 'FIK AI'}
                    </span>
                  </div>
                  <div
                    className={`relative group max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg ${
                      isUser
                        ? 'bg-cyan-950/50 border border-cyan-500/30 text-cyan-100 rounded-tr-none'
                        : 'bg-[#030712] border border-cyan-500/20 text-slate-100 rounded-tl-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{turn.content}</p>
                    {!isUser && (
                      <button
                        onClick={() => handleCopy(turn.content, index)}
                        className="absolute top-2 right-2 p-1 rounded-md bg-black/40 text-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                        title="Copy response"
                      >
                        {copiedIndex === index ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Text Input Footer */}
        <div className="p-4 border-t border-cyan-500/15 bg-cyan-950/20 shrink-0">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type your message to FIK AI..."
              disabled={isSubmitting}
              className="flex-1 bg-[#030712] border border-cyan-500/30 rounded-xl px-4 py-3 text-sm text-cyan-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isSubmitting}
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 text-xs font-semibold tracking-wider hover:bg-cyan-500/35 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Send className="w-4 h-4 mr-1.5" />
              <span>SEND</span>
            </button>
          </form>
          {turns.length > 0 && (
            <div className="flex justify-between items-center mt-3 pt-2 border-t border-cyan-500/10">
              <span className="text-[11px] text-slate-400">
                {turns.length} message{turns.length === 1 ? '' : 's'} in history
              </span>
              <button
                onClick={onClearHistory}
                className="text-[11px] text-amber-400 hover:text-amber-300 font-medium transition-colors"
              >
                Clear History
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
