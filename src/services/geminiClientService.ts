import { VoiceTurn, VoiceTurnResponse } from '../types/chat';

export async function checkServerHealth(): Promise<{
  ok: boolean;
  configured: boolean;
  model?: string;
  ttsModel?: string;
  message: string;
}> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`Server health check returned ${res.status}`);
  }
  return res.json();
}

/**
 * Sends a voice conversation turn to Gemini with robust error handling:
 * - Exponential backoff retries for transient 500, 503, 504, 404, or network errors.
 * - Immediate failure for 401 / Invalid API Key without unnecessary retrying.
 * - Clear distinction between transient issues (triggering reconnecting state) and permanent configuration issues.
 */
export async function sendVoiceTurnToGemini(
  messages: VoiceTurn[],
  signal: AbortSignal,
  language = 'auto',
  onReconnecting?: () => void
): Promise<VoiceTurnResponse> {
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        let errorBody: any = null;
        try {
          errorBody = await response.json();
          if (errorBody?.error) errorMessage = errorBody.error;
        } catch {
          // Use status fallback
        }

        // 401 Unauthorized / Invalid API Key: Do not retry, fail immediately
        if (response.status === 401 || errorMessage.toLowerCase().includes('api_key') || errorMessage.toLowerCase().includes('invalid')) {
          throw new Error(errorMessage || 'Invalid Gemini API key. Please check your configuration.');
        }

        // 429 Rate Limit / Quota: Pass message through
        if (response.status === 429) {
          throw new Error(errorMessage || 'Gemini API quota or rate limit reached.');
        }

        // Transient errors (500, 503, 504, 404): Retry with exponential backoff if attempts remain
        if ((response.status >= 500 || response.status === 404) && attempt < maxAttempts) {
          onReconnecting?.();
          const backoffMs = attempt * 700 + Math.random() * 300; // e.g. ~700ms, ~1400ms
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
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
      if ((err as Error)?.name === 'AbortError' || signal.aborted) {
        throw err;
      }

      const errMessage = err instanceof Error ? err.message : String(err);
      
      // If invalid API key, throw immediately
      if (errMessage.toLowerCase().includes('api_key') || errMessage.toLowerCase().includes('invalid') || errMessage.toLowerCase().includes('401')) {
        throw err;
      }

      lastError = err;

      // Retry transient network or server errors with exponential backoff
      if (attempt < maxAttempts) {
        onReconnecting?.();
        const backoffMs = attempt * 800 + Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to communicate with Gemini AI service after multiple attempts.');
}
