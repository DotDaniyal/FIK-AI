import { JarvisState } from '../types/chat';
import { AudioPlaybackService } from './audioPlaybackService';
import { ConversationStore } from './conversationStore';
import { classifyClientApiError, VoiceSystemError } from './errorService';
import { sendVoiceTurnToGemini } from './geminiClientService';
import { SpeechRecognitionService } from './speechRecognitionService';

export interface VoiceSessionUIHandlers {
  onStateChange: (state: JarvisState) => void;
  onAudioLevelChange: (level: number) => void;
  onCaptionChange: (caption: string) => void;
  onErrorChange: (errorMessage: string) => void;
}

export class VoiceSessionManager {
  private state: JarvisState = 'IDLE';
  private isSessionActive = false;
  private recognitionService = new SpeechRecognitionService();
  private audioService = new AudioPlaybackService();
  private conversationStore = new ConversationStore();
  private abortController: AbortController | null = null;
  private transitionTimer: number | null = null;
  private consecutiveRecoverableErrors = 0;
  private selectedLanguage = 'auto';
  private ui: VoiceSessionUIHandlers;

  public setLanguage(lang: string): void {
    this.selectedLanguage = lang;
  }

  public setSpeechRate(rate: number): void {
    this.audioService.setRate(rate);
  }

  public getConversationTurns(): any[] {
    return this.conversationStore.getTurns();
  }

  public clearHistory(): void {
    this.conversationStore.clear();
  }

  public async submitTextQuestion(questionText: string): void {
    this.isSessionActive = true;
    await this.handleUserQuestion(questionText);
  }

  constructor(ui: VoiceSessionUIHandlers) {
    this.ui = ui;
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  public init(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public destroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.stopSession();
  }

  public getState(): JarvisState {
    return this.state;
  }

  public isActive(): boolean {
    return this.isSessionActive;
  }

  private setState(next: JarvisState): void {
    this.state = next;
    this.ui.onStateChange(next);
  }

  private clearTransitionTimer(): void {
    if (this.transitionTimer !== null) {
      window.clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
  }

  /**
   * Starts the continuous LISTEN -> THINK -> SPEAK -> LISTEN cycle.
   * Must be invoked from a user interaction (click/tap) on initial start so audio is unlocked.
   */
  public async startOrInterruptSession(): Promise<void> {
    this.clearTransitionTimer();

    // Always unlock audio output on user click gesture
    await this.audioService.unlockAudioOnUserGesture();

    // If FIK AI is currently speaking, clicking the core interrupts speech and listens immediately
    if (this.isSessionActive && this.state === 'SPEAKING') {
      this.audioService.stopPlayback();
      this.ui.onAudioLevelChange(0);
      this.enterListeningState();
      return;
    }

    // If already listening or thinking, keep active or restart listening cleanly
    this.isSessionActive = true;
    this.consecutiveRecoverableErrors = 0;
    this.ui.onErrorChange('');
    this.enterListeningState();
  }

  /**
   * Immediately halts all microphone capture, in-flight Gemini requests, and audio playback.
   */
  public stopSession(): void {
    this.isSessionActive = false;
    this.consecutiveRecoverableErrors = 0;
    this.clearTransitionTimer();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.recognitionService.stopListening();
    this.audioService.stopPlayback();

    this.ui.onAudioLevelChange(0);
    this.ui.onCaptionChange('');
    this.ui.onErrorChange('');
    this.setState('IDLE');
  }

  private enterListeningState(): void {
    if (!this.isSessionActive) return;

    this.clearTransitionTimer();
    // Ensure speech output is completely stopped before opening the microphone
    this.audioService.stopPlayback();
    this.ui.onAudioLevelChange(0);

    this.recognitionService.startListening({
      onListeningStart: () => {
        if (!this.isSessionActive) return;
        this.ui.onErrorChange('');
        this.setState('LISTENING');
      },
      onInterimTranscript: (text, approxLevel) => {
        if (!this.isSessionActive) return;
        this.ui.onCaptionChange(`"${text}"`);
        this.ui.onAudioLevelChange(approxLevel);
        // Reset pulsing level smoothly
        window.setTimeout(() => {
          if (this.state === 'LISTENING') {
            this.ui.onAudioLevelChange(0.12);
          }
        }, 140);
      },
      onFinalUtterance: (questionText) => {
        if (!this.isSessionActive) return;
        this.consecutiveRecoverableErrors = 0;
        this.handleUserQuestion(questionText);
      },
      onError: (err: VoiceSystemError) => {
        if (!this.isSessionActive) return;
        this.handleSystemError(err);
      },
    }, this.selectedLanguage);
  }

  private async handleUserQuestion(questionText: string): Promise<void> {
    if (!this.isSessionActive) return;

    // 1. Stop microphone recognition so FIK AI never hears background noise or its own upcoming voice
    this.recognitionService.stopListening();
    this.audioService.stopPlayback();
    this.ui.onAudioLevelChange(0);

    // 2. Transition to THINKING
    this.setState('THINKING');
    this.ui.onCaptionChange(`"${questionText}"`);
    this.ui.onErrorChange('');

    if (this.abortController) {
      this.abortController.abort();
    }
    const controller = new AbortController();
    this.abortController = controller;

    try {
      const requestMessages = this.conversationStore.buildRequestMessages(questionText);

      const result = await sendVoiceTurnToGemini(
        requestMessages,
        controller.signal,
        this.selectedLanguage,
        () => {
          if (this.isSessionActive) {
            this.setState('RECONNECTING');
          }
        }
      );

      if (!this.isSessionActive || controller.signal.aborted) {
        return;
      }

      // Save turn in active conversation store so follow-up questions preserve context
      this.conversationStore.addUserAndAssistantTurn(questionText, result.replyText);

      // 3. Transition to SPEAKING and play the answer aloud automatically
      await this.audioService.speakResponse({
        text: result.replyText,
        audioBase64: result.audioBase64,
        language: this.selectedLanguage,
        onStart: () => {
          if (!this.isSessionActive) return;
          this.setState('SPEAKING');
          this.ui.onCaptionChange(result.replyText);
        },
        onLevel: (level) => {
          if (this.isSessionActive && this.state === 'SPEAKING') {
            this.ui.onAudioLevelChange(level);
          }
        },
        onSentenceCaption: (sentence) => {
          if (this.isSessionActive && this.state === 'SPEAKING') {
            this.ui.onCaptionChange(sentence);
          }
        },
        onEnd: () => {
          this.ui.onAudioLevelChange(0);
          if (!this.isSessionActive) return;

          // 4. Automatically resume listening after speech playback finishes!
          // 350ms cooldown prevents room speaker reverberation from being captured.
          this.transitionTimer = window.setTimeout(() => {
            if (this.isSessionActive) {
              this.ui.onCaptionChange('');
              this.enterListeningState();
            }
          }, 350);
        },
        onError: (audioErrMsg) => {
          this.ui.onAudioLevelChange(0);
          if (!this.isSessionActive) return;
          this.ui.onErrorChange(audioErrMsg);
          // Still resume listening after brief pause so conversation doesn't die
          this.transitionTimer = window.setTimeout(() => {
            if (this.isSessionActive) {
              this.enterListeningState();
            }
          }, 1500);
        },
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || !this.isSessionActive) {
        return;
      }
      const classified = classifyClientApiError(err);
      this.handleSystemError(classified);
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  private handleSystemError(err: VoiceSystemError): void {
    this.ui.onAudioLevelChange(0);

    if (err.recoverable && this.consecutiveRecoverableErrors < 3 && this.isSessionActive) {
      this.consecutiveRecoverableErrors += 1;
      this.setState('RECONNECTING');
      if (err.message) {
        this.ui.onErrorChange(err.message);
      }
      this.clearTransitionTimer();
      this.transitionTimer = window.setTimeout(() => {
        if (this.isSessionActive) {
          this.enterListeningState();
        }
      }, 1200);
      return;
    }

    // Non-recoverable error (e.g., mic permission denied or missing API key)
    this.isSessionActive = false;
    this.recognitionService.stopListening();
    this.audioService.stopPlayback();
    this.ui.onErrorChange(err.message || 'Voice system needs attention.');
    this.setState('ERROR');
  }

  private handleVisibilityChange(): void {
    if (typeof document === 'undefined') return;
    if (
      document.visibilityState === 'visible' &&
      this.isSessionActive &&
      this.state === 'LISTENING'
    ) {
      this.enterListeningState();
    }
  }
}
