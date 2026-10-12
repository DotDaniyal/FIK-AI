export interface VoiceSystemError {
  code: string;
  message: string;
  recoverable: boolean;
}

export function classifyRecognitionError(errorCode: string): VoiceSystemError {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        code: errorCode,
        message:
          'Microphone permission was denied. Please allow microphone access in your browser address bar and click Start FIK AI.',
        recoverable: false,
      };
    case 'audio-capture':
      return {
        code: errorCode,
        message: 'No working microphone was detected. Please connect a microphone and try again.',
        recoverable: false,
      };
    case 'network':
      return {
        code: errorCode,
        message: 'Browser speech recognition encountered a network interruption. Reconnecting…',
        recoverable: true,
      };
    case 'no-speech':
    case 'aborted':
      return {
        code: errorCode,
        message: '',
        recoverable: true,
      };
    default:
      return {
        code: errorCode,
        message: `Microphone recognition issue (${errorCode}). Reconnecting…`,
        recoverable: true,
      };
  }
}

export function classifyClientApiError(error: unknown): VoiceSystemError {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (lower.includes('api_key') || lower.includes('invalid gemini api key') || lower.includes('missing on the server')) {
    return {
      code: 'API_KEY_ERROR',
      message: msg,
      recoverable: false,
    };
  }
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429')) {
    return {
      code: 'RATE_LIMIT',
      message: 'Gemini API rate limit reached. Waiting briefly before resuming listening.',
      recoverable: true,
    };
  }
  if (lower.includes('high demand') || lower.includes('503') || lower.includes('timed out') || lower.includes('network')) {
    return {
      code: 'TRANSIENT_API',
      message: 'Temporary connection delay with Gemini AI. Reconnecting…',
      recoverable: true,
    };
  }
  return {
    code: 'API_FAILURE',
    message: msg || 'Voice request failed. Returning to listening mode.',
    recoverable: true,
  };
}
