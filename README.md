# JARVIS AI — Pure Voice-First Personal AI Assistant

JARVIS AI is a minimal, full-screen, voice-first AI assistant powered by the official Google GenAI SDK (`@google/genai`).

## Interaction Flow

1. **JARVIS ONLINE (`IDLE`)**: The application opens to a full-screen dark viewport with the animated cyan JARVIS core in the center.
2. **LISTENING (`LISTENING`)**: Click the central JARVIS core once to activate continuous voice conversation. The outer rings respond to real measured microphone audio levels while `SpeechRecognition` captures your question in English, Urdu, or Roman Urdu.
3. **PROCESSING (`THINKING`)**: Your recognized spoken question is sent to the server-side Gemini endpoint (`POST /api/chat`), preserving active conversation context.
4. **SPEAKING (`SPEAKING`)**: JARVIS automatically speaks the generated response aloud through `SpeechSynthesis` (with server-side Gemini TTS `/api/tts` fallback) while the core pulses in sync with speech playback.
5. **Continuous Loop**: Once JARVIS finishes speaking the answer, it automatically returns to `LISTENING` for your next question until you press `STOP`.

## Environment Variables

Copy `.env.example` to `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
```
