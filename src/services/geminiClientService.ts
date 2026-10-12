import { VoiceTurn, VoiceTurnResponse } from '../types/chat';

export async function checkServerHealth(): Promise<{
  ok: boolean;
  configured: boolean;
  message: string;
}> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`Server health check returned ${res.status}`);
  }
  return res.json();
}

export async function sendVoiceTurnToGemini(
  messages: VoiceTurn[],
  signal: AbortSignal,
  language = 'auto',
  onReconnecting?: () => void
): Promise<VoiceTurnResponse> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const response = await fetch('/api/voice-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          messages,
          language,
          clientTimeInfo: new Date().toString(),
        }),
      });

      if (!response.ok) {
        let errorMessage = `Request failed (${response.status})`;
        try {
          const errJson = await response.json();
          if (errJson?.error) errorMessage = errJson.error;
        } catch {
          // Use status fallback
        }

        // If 503 or 504 on first attempt, trigger reconnecting callback and retry once
        if ((response.status === 503 || response.status === 504) && attempt === 1) {
          onReconnecting?.();
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }

        throw new Error(errorMessage);
      }

      const data = (await response.json()) as VoiceTurnResponse;
      if (!data || typeof data.replyText !== 'string' || !data.replyText.trim()) {
        throw new Error('Gemini returned an empty response.');
      }

      return data;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw err;
      }
      lastError = err;
      if (attempt === 1) {
        onReconnecting?.();
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to communicate with Gemini AI service.');
}
