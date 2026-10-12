import { classifyRecognitionError, VoiceSystemError } from './errorService';

interface WebSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
}

export interface SpeechRecognitionCallbacks {
  onListeningStart: () => void;
  onInterimTranscript: (text: string, approxLevel: number) => void;
  onFinalUtterance: (questionText: string) => void;
  onError: (err: VoiceSystemError) => void;
}

const SILENCE_COMMIT_MS = 1150;

export class SpeechRecognitionService {
  private recognition: WebSpeechRecognition | null = null;
  private isListeningDesired = false;
  private sessionId = 0;
  private silenceTimer: number | null = null;
  private restartTimer: number | null = null;

  public isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    );
  }

  private clearTimers(): void {
    if (this.silenceTimer !== null) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  /**
   * Starts a single controlled recognition session.
   * Automatically detects end of user utterance via final result + silence window,
   * and prevents duplicate submissions.
   */
  public startListening(callbacks: SpeechRecognitionCallbacks): void {
    this.stopListening();

    if (!this.isSupported()) {
      callbacks.onError({
        code: 'UNSUPPORTED_BROWSER',
        message:
          'Speech recognition is not supported in this browser. Please open JARVIS in Chrome, Edge, or Safari.',
        recoverable: false,
      });
      return;
    }

    this.isListeningDesired = true;
    const currentSessionId = ++this.sessionId;
    this.launchInstance(currentSessionId, callbacks);
  }

  private launchInstance(
    currentSessionId: number,
    callbacks: SpeechRecognitionCallbacks
  ): void {
    if (!this.isListeningDesired || currentSessionId !== this.sessionId) {
      return;
    }

    const Constructor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    let instance: WebSpeechRecognition;
    try {
      instance = new Constructor();
    } catch {
      callbacks.onError({
        code: 'INIT_FAILED',
        message: 'Could not initialize browser speech recognition.',
        recoverable: false,
      });
      return;
    }

    // Use continuous=true so short pauses within a sentence don't cut the user off,
    // paired with a 1.15s silence detector to automatically submit once the user finishes speaking.
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = navigator.language || 'en-US';
    this.recognition = instance;

    let accumulatedFinal = '';
    let latestInterim = '';
    let hasCommittedUtterance = false;

    const commitUtteranceOnce = () => {
      if (hasCommittedUtterance || currentSessionId !== this.sessionId) {
        return;
      }
      const fullSpoken = `${accumulatedFinal} ${latestInterim}`.replace(/\s+/g, ' ').trim();
      if (!fullSpoken) return;

      hasCommittedUtterance = true;
      this.isListeningDesired = false;
      this.clearTimers();

      try {
        instance.onresult = null;
        instance.onend = null;
        instance.onerror = null;
        instance.stop();
      } catch {
        // Ignore stop errors
      }
      this.recognition = null;
      callbacks.onFinalUtterance(fullSpoken);
    };

    instance.onstart = () => {
      if (currentSessionId !== this.sessionId || !this.isListeningDesired) return;
      callbacks.onListeningStart();
    };

    instance.onresult = (event: any) => {
      if (
        currentSessionId !== this.sessionId ||
        !this.isListeningDesired ||
        hasCommittedUtterance
      ) {
        return;
      }

      let interimSegment = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0]?.transcript || '';
        if (res.isFinal) {
          accumulatedFinal += transcript + ' ';
        } else {
          interimSegment += transcript;
        }
      }
      latestInterim = interimSegment;

      const combined = `${accumulatedFinal} ${latestInterim}`.replace(/\s+/g, ' ').trim();
      if (combined) {
        const levelEstimate = Math.min(1, 0.35 + (combined.length % 7) * 0.08);
        callbacks.onInterimTranscript(combined, levelEstimate);

        // Reset silence commit timer whenever new words arrive
        if (this.silenceTimer !== null) {
          window.clearTimeout(this.silenceTimer);
        }
        this.silenceTimer = window.setTimeout(() => {
          commitUtteranceOnce();
        }, SILENCE_COMMIT_MS);
      }
    };

    instance.onerror = (event: any) => {
      if (currentSessionId !== this.sessionId || hasCommittedUtterance) return;
      const errCode = event?.error || 'unknown';

      if (errCode === 'aborted') {
        return;
      }

      // If no speech was heard during the browser's timeout window, commit any captured words
      // or quietly keep listening if the session is still active.
      if (errCode === 'no-speech') {
        const candidate = `${accumulatedFinal} ${latestInterim}`.trim();
        if (candidate) {
          commitUtteranceOnce();
        }
        return;
      }

      const classified = classifyRecognitionError(errCode);
      if (!classified.recoverable) {
        this.stopListening();
      }
      callbacks.onError(classified);
    };

    instance.onend = () => {
      if (currentSessionId !== this.sessionId || hasCommittedUtterance) return;

      const candidate = `${accumulatedFinal} ${latestInterim}`.trim();
      if (candidate) {
        commitUtteranceOnce();
        return;
      }

      // If the user hasn't spoken yet and the browser timed out its recognition window (~8-10s of silence),
      // seamlessly restart recognition as long as the user hasn't stopped JARVIS.
      if (this.isListeningDesired && document.visibilityState === 'visible') {
        this.restartTimer = window.setTimeout(() => {
          this.launchInstance(currentSessionId, callbacks);
        }, 250);
      }
    };

    try {
      instance.start();
    } catch {
      if (this.isListeningDesired && currentSessionId === this.sessionId) {
        this.restartTimer = window.setTimeout(() => {
          this.launchInstance(currentSessionId, callbacks);
        }, 400);
      }
    }
  }

  public stopListening(): void {
    this.isListeningDesired = false;
    this.sessionId += 1;
    this.clearTimers();

    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {
        // Ignore abort errors
      }
      this.recognition = null;
    }
  }
}
