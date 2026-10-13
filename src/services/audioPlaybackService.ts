// Dedicated Audio Output & Speech Playback Service
// Supports:
// 1. Real Gemini Model-Generated Audio (24kHz mono 16-bit WAV via Web Audio API AudioContext)
// 2. Reliable Browser SpeechSynthesis fallback with voice loading, language matching, and sentence queuing.

export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_~>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class AudioPlaybackService {
  private audioCtx: AudioContext | null = null;
  private activeSourceNode: AudioBufferSourceNode | null = null;
  private rafId: number | null = null;
  private speechWatchdogTimer: number | null = null;
  private speechPulseInterval: number | null = null;
  private playbackGeneration = 0;
  private voicesLoaded = false;
  private speechRate = 1.0;

  public setRate(rate: number): void {
    this.speechRate = rate;
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      this.audioCtx = new AudioCtx();
    }
    return this.audioCtx;
  }

  /**
   * Must be called inside a direct user click handler ("Start FIK AI")
   * to unlock Web Audio API and SpeechSynthesis across Chrome, Safari, Edge, and mobile browsers.
   */
  public async unlockAudioOnUserGesture(): Promise<void> {
    const ctx = this.ensureAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      // Play a subtle 90ms FIK AI readiness chime through Web Audio to permanently unlock speaker output
      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.08);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.095);
      } catch {
        // Ignore chime error
      }
    }

    // Preload browser SpeechSynthesis voices
    await this.waitForVoices(600);
  }

  public async waitForVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return [];
    }
    const existing = window.speechSynthesis.getVoices();
    if (existing && existing.length > 0) {
      this.voicesLoaded = true;
      return existing;
    }

    return new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let resolved = false;
      const timer = window.setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(window.speechSynthesis.getVoices() || []);
        }
      }, timeoutMs);

      const handleVoicesChanged = () => {
        if (!resolved) {
          const loaded = window.speechSynthesis.getVoices();
          if (loaded && loaded.length > 0) {
            resolved = true;
            this.voicesLoaded = true;
            window.clearTimeout(timer);
            window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
            resolve(loaded);
          }
        }
      };

      window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
    });
  }

  /**
   * Immediately cancels any active Web Audio buffer or browser SpeechSynthesis utterance.
   */
  public stopPlayback(): void {
    this.playbackGeneration += 1;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.speechWatchdogTimer !== null) {
      window.clearTimeout(this.speechWatchdogTimer);
      this.speechWatchdogTimer = null;
    }
    if (this.speechPulseInterval !== null) {
      window.clearInterval(this.speechPulseInterval);
      this.speechPulseInterval = null;
    }

    if (this.activeSourceNode) {
      try {
        this.activeSourceNode.onended = null;
        this.activeSourceNode.stop();
        this.activeSourceNode.disconnect();
      } catch {
        // Ignore already stopped source
      }
      this.activeSourceNode = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
  }

  /**
   * Plays the assistant response aloud.
   * Prefers real model-generated WAV audio (from gemini-3.8-flash-lite-tts) when provided,
   * and falls back to browser SpeechSynthesis if neural audio is unavailable.
   */
  public async speakResponse(options: {
    text: string;
    audioBase64?: string;
    onStart: () => void;
    onLevel: (level: number) => void;
    onSentenceCaption?: (sentence: string) => void;
    onEnd: () => void;
    onError: (errorMessage: string) => void;
  }): Promise<void> {
    this.stopPlayback();
    const currentGen = this.playbackGeneration;
    const cleanText = cleanTextForSpeech(options.text);

    if (!cleanText && !options.audioBase64) {
      options.onEnd();
      return;
    }

    // 1. Try playing real Gemini model-generated WAV audio via Web Audio API
    if (options.audioBase64) {
      const playedNeural = await this.playNeuralWavBuffer(
        options.audioBase64,
        currentGen,
        options.onStart,
        options.onLevel,
        options.onEnd
      );
      if (playedNeural || currentGen !== this.playbackGeneration) {
        return;
      }
    }

    // 2. Fallback to browser SpeechSynthesis
    await this.speakViaBrowserTTS(
      cleanText,
      currentGen,
      options.onStart,
      options.onLevel,
      options.onSentenceCaption,
      options.onEnd,
      options.onError
    );
  }

  private decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Direct PCM / RIFF WAV parser fallback for 24kHz 16-bit mono audio
   */
  private decodePcmWavManually(ctx: AudioContext, rawBuffer: ArrayBuffer): AudioBuffer | null {
    try {
      const bytes = new Uint8Array(rawBuffer);
      let dataOffset = 0;
      let sampleRate = 24000;

      // Check for RIFF WAVE header (44 bytes standard)
      if (
        bytes.length > 44 &&
        bytes[0] === 0x52 && // 'R'
        bytes[1] === 0x49 && // 'I'
        bytes[2] === 0x46 && // 'F'
        bytes[3] === 0x46 // 'F'
      ) {
        const view = new DataView(rawBuffer);
        const headerRate = view.getUint32(24, true);
        if (headerRate >= 8000 && headerRate <= 96000) {
          sampleRate = headerRate;
        }
        dataOffset = 44;
      }

      const pcmByteLength = rawBuffer.byteLength - dataOffset;
      const sampleCount = Math.floor(pcmByteLength / 2);
      if (sampleCount <= 0) return null;

      const audioBuffer = ctx.createBuffer(1, sampleCount, sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      const view = new DataView(rawBuffer, dataOffset, sampleCount * 2);

      for (let i = 0; i < sampleCount; i++) {
        const int16 = view.getInt16(i * 2, true);
        channelData[i] = int16 / 32768;
      }
      return audioBuffer;
    } catch {
      return null;
    }
  }

  private async playNeuralWavBuffer(
    base64Audio: string,
    generation: number,
    onStart: () => void,
    onLevel: (level: number) => void,
    onEnd: () => void
  ): Promise<boolean> {
    const ctx = this.ensureAudioContext();
    if (!ctx) return false;

    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      if (generation !== this.playbackGeneration) return true;

      const arrayBuffer = this.decodeBase64ToArrayBuffer(base64Audio);
      let decodedBuffer: AudioBuffer | null = null;

      try {
        decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      } catch {
        decodedBuffer = this.decodePcmWavManually(ctx, arrayBuffer);
      }

      if (!decodedBuffer || generation !== this.playbackGeneration) {
        return false;
      }

      return new Promise<boolean>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = decodedBuffer!;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.65;

        source.connect(analyser);
        analyser.connect(ctx.destination);
        this.activeSourceNode = source;

        const timeData = new Uint8Array(analyser.fftSize);
        const measureAmplitude = () => {
          if (generation !== this.playbackGeneration || !this.activeSourceNode) {
            return;
          }
          analyser.getByteTimeDomainData(timeData);
          let sumSq = 0;
          for (let i = 0; i < timeData.length; i++) {
            const norm = (timeData[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / timeData.length);
          onLevel(Math.min(1, rms * 3.8));
          this.rafId = requestAnimationFrame(measureAmplitude);
        };

        source.onended = () => {
          if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
          }
          if (this.activeSourceNode === source) {
            this.activeSourceNode = null;
          }
          onLevel(0);
          if (generation === this.playbackGeneration) {
            onEnd();
          }
          resolve(true);
        };

        onStart();
        source.start(0);
        this.rafId = requestAnimationFrame(measureAmplitude);
      });
    } catch {
      return false;
    }
  }

  private selectVoiceForText(
    voices: SpeechSynthesisVoice[],
    text: string
  ): { voice: SpeechSynthesisVoice | null; lang: string } {
    const hasUrduScript = /[\u0600-\u06FF]/.test(text);

    if (hasUrduScript) {
      const urduVoice = voices.find(
        (v) => v.lang.toLowerCase().startsWith('ur') || v.lang.toLowerCase().startsWith('hi')
      );
      return {
        voice: urduVoice || null,
        lang: urduVoice?.lang || 'ur-PK',
      };
    }

    const jarvisVoiceNames = [
      'google uk english male',
      'daniel',
      'arthur',
      'oliver',
      'microsoft george',
      'microsoft ryan',
      'alex',
      'google us english',
    ];

    for (const target of jarvisVoiceNames) {
      const found = voices.find((v) => v.name.toLowerCase().includes(target));
      if (found) {
        return { voice: found, lang: found.lang || 'en-GB' };
      }
    }

    const gbVoice = voices.find((v) => v.lang.toLowerCase().startsWith('en-gb'));
    if (gbVoice) return { voice: gbVoice, lang: gbVoice.lang };

    const enVoice = voices.find((v) => v.lang.toLowerCase().startsWith('en'));
    if (enVoice) return { voice: enVoice, lang: enVoice.lang };

    return { voice: voices[0] || null, lang: 'en-US' };
  }

  private async speakViaBrowserTTS(
    cleanText: string,
    generation: number,
    onStart: () => void,
    onLevel: (level: number) => void,
    onSentenceCaption: ((sentence: string) => void) | undefined,
    onEnd: () => void,
    onError: (errorMessage: string) => void
  ): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onError('Browser speech synthesis is not supported on this device.');
      return;
    }

    const voices = await this.waitForVoices(1000);
    if (generation !== this.playbackGeneration) return;

    // Wait 80ms after any previous cancel() so Chromium does not drop the new utterance
    await new Promise((r) => setTimeout(r, 80));
    if (generation !== this.playbackGeneration) return;

    const sentences =
      cleanText
        .match(/[^.!?।\n]+[.!?।\n]+|[^.!?।\n]+$/g)
        ?.map((s) => s.trim())
        .filter(Boolean) || [cleanText];

    const { voice, lang } = this.selectVoiceForText(voices, cleanText);

    onStart();

    this.speechPulseInterval = window.setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        onLevel(0.32 + Math.random() * 0.42);
      } else {
        onLevel(0.06);
      }
    }, 90);

    // Speak sentences sequentially one by one to guarantee order and prevent Chromium queue lockup
    for (let i = 0; i < sentences.length; i++) {
      if (generation !== this.playbackGeneration) return;
      const sentence = sentences[i];
      onSentenceCaption?.(sentence);

      await new Promise<void>((resolve) => {
        let settled = false;
        const finishSentence = () => {
          if (settled) return;
          settled = true;
          if (this.speechWatchdogTimer !== null) {
            window.clearTimeout(this.speechWatchdogTimer);
            this.speechWatchdogTimer = null;
          }
          resolve();
        };

        // Safety watchdog in case the browser's TTS engine fails to fire onend
        const estimatedMs = Math.max(3500, Math.min(20000, sentence.length * 85));
        this.speechWatchdogTimer = window.setTimeout(finishSentence, estimatedMs);

        const utterance = new SpeechSynthesisUtterance(sentence);
        utterance.lang = lang;
        utterance.rate = this.speechRate;
        utterance.pitch = 0.96;
        utterance.volume = 1.0;
        if (voice) {
          utterance.voice = voice;
        }

        utterance.onboundary = () => {
          onLevel(0.6 + Math.random() * 0.35);
        };
        utterance.onend = finishSentence;
        utterance.onerror = () => finishSentence();

        try {
          window.speechSynthesis.speak(utterance);
        } catch {
          finishSentence();
        }
      });
    }

    if (this.speechPulseInterval !== null) {
      window.clearInterval(this.speechPulseInterval);
      this.speechPulseInterval = null;
    }
    onLevel(0);

    if (generation === this.playbackGeneration) {
      onEnd();
    }
  }
}
