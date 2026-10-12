export type JarvisState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'RECONNECTING'
  | 'ERROR';

export const JARVIS_STATE_LABELS: Record<JarvisState, string> = {
  IDLE: 'JARVIS ONLINE',
  LISTENING: 'LISTENING TO YOU',
  THINKING: 'PROCESSING YOUR QUESTION',
  SPEAKING: 'SPEAKING RESPONSE',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'VOICE SYSTEM NEEDS ATTENTION',
};

export interface VoiceTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface VoiceTurnResponse {
  replyText: string;
  audioBase64?: string;
  mimeType?: string;
  model: string;
  ttsError?: string;
}
