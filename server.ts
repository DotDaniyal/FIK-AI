import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  GoogleGenAI,
  FunctionDeclaration,
  Type,
  GenerateContentResponse,
  ThinkingLevel,
} from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prioritized list of verified Gemini 3 models.
// gemini-3.1-flash-lite with ThinkingLevel.MINIMAL provides the fastest, lowest-latency conversational response.
const MODEL_FALLBACK_ORDER = [
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
] as const;

const TTS_MODEL = 'gemini-3.8-flash-lite-tts';

function getPrimaryModel(): string {
  const envModel = process.env.GEMINI_MODEL?.trim();
  if (envModel && (MODEL_FALLBACK_ORDER as readonly string[]).includes(envModel)) {
    return envModel;
  }
  return 'gemini-3.1-flash-lite';
}

function getModelFallbackChain(): string[] {
  const primary = getPrimaryModel();
  return [primary, ...MODEL_FALLBACK_ORDER.filter((m) => m !== primary)];
}

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'your_gemini_api_key') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const FIK_AI_VOICE_SYSTEM_INSTRUCTION = `You are FIK AI, the intelligent, calm, composed personal AI assistant inspired by Iron Man's JARVIS.

CRITICAL SPOKEN-VOICE RULES:
1. Every response you generate is spoken aloud directly to the user through speakers.
2. Write ONLY natural, fluent spoken sentences. Do NOT use Markdown formatting, asterisks, hashtags, bullet points, numbered lists, or code blocks.
3. Keep answers direct, clear, and concise (1 to 3 spoken sentences) unless the user explicitly asks for a longer explanation.
4. Match the user's language naturally:
   - If the user speaks English, respond in natural, articulate English.
   - If the user speaks Urdu or Roman Urdu (or asks you to explain in Urdu), respond naturally in Urdu or Roman Urdu.
5. Remember the active conversation context so follow-up commands like "Now explain it in Urdu" or "Tell me more about that" work seamlessly.
6. Never claim to have performed external device actions unless verified.`;

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateBucket>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const existing = rateLimitMap.get(ip);

  if (!existing || now > existing.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000);
    return { allowed: false, retryAfterSec };
  }

  existing.count += 1;
  return { allowed: true };
}

const MAX_MESSAGE_LENGTH = 8_000;
const MAX_CONTEXT_MESSAGES = 16;

interface IncomingMessage {
  role: 'user' | 'assistant' | 'model';
  content: string;
}

const getWeatherDeclaration: FunctionDeclaration = {
  name: 'getCurrentWeather',
  description: 'Fetches real-time current weather conditions for a city or location.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      location: {
        type: Type.STRING,
        description: 'City name (e.g., "London", "Karachi", "Lahore", "New York").',
      },
    },
    required: ['location'],
  },
};

async function fetchRealWeather(location: string): Promise<Record<string, unknown>> {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(5000) });
    if (!geoRes.ok) return { error: `Geocoding status ${geoRes.status}` };
    const geoData = (await geoRes.json()) as {
      results?: Array<{
        name: string;
        country?: string;
        latitude: number;
        longitude: number;
      }>;
    };
    const place = geoData.results?.[0];
    if (!place) return { error: `Location "${location}" not found.` };

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m&timezone=auto`;
    const weatherRes = await fetch(weatherUrl, { signal: AbortSignal.timeout(5000) });
    if (!weatherRes.ok) return { error: `Weather status ${weatherRes.status}` };
    const weatherData = (await weatherRes.json()) as Record<string, unknown>;
    return {
      location: [place.name, place.country].filter(Boolean).join(', '),
      current: weatherData.current,
      units: weatherData.current_units,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Weather lookup failed.' };
  }
}

function classifyApiError(error: unknown): { status: number; message: string } {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('unauthenticated') ||
    lower.includes('401')
  ) {
    return {
      status: 401,
      message: 'Invalid Gemini API key. Check GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (
    lower.includes('quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('429') ||
    lower.includes('rate limit')
  ) {
    return {
      status: 429,
      message: 'Gemini API quota or rate limit reached. Please wait a moment.',
    };
  }
  if (lower.includes('503') || lower.includes('high demand') || lower.includes('overloaded')) {
    return {
      status: 503,
      message: 'Gemini model is experiencing high demand. Retrying automatically.',
    };
  }
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return {
      status: 504,
      message: 'Request timed out. Reconnecting.',
    };
  }
  return {
    status: 500,
    message: 'Unable to reach Gemini AI service.',
  };
}

function cleanTextForServerSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_~>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateAndFormatMessages(messages: unknown): Array<{
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}> | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const recent: IncomingMessage[] = messages.slice(-MAX_CONTEXT_MESSAGES);
  const formatted: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const msg of recent) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'model') {
      return null;
    }
    const text =
      typeof msg.content === 'string' ? msg.content.trim().slice(0, MAX_MESSAGE_LENGTH) : '';
    if (!text) continue;
    formatted.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text }],
    });
  }

  if (formatted.length === 0 || formatted[formatted.length - 1].role !== 'user') {
    return null;
  }
  return formatted;
}

async function generateReplyWithFallback(
  ai: GoogleGenAI,
  formattedContents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
  systemInstruction: string
): Promise<{ replyText: string; usedModel: string }> {
  const modelsToTry = getModelFallbackChain();
  let lastError: unknown = null;

  for (const model of modelsToTry) {
    try {
      const latestUserText =
        formattedContents[formattedContents.length - 1].parts[0].text.toLowerCase();
      const isWeatherQuery =
        /\b(weather|temperature|forecast|rain|celsius|fahrenheit|humidity|mausam)\b/i.test(
          latestUserText
        );

      const contentsCopy = formattedContents.map((c) => ({
        role: c.role,
        parts: [...c.parts],
      }));

      if (isWeatherQuery) {
        const toolCheck = await ai.models.generateContent({
          model,
          contents: contentsCopy,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: [getWeatherDeclaration] }],
            ...(model.startsWith('gemini-3')
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        });

        const fnCalls = toolCheck.functionCalls;
        if (fnCalls && fnCalls.length > 0 && fnCalls[0].name === 'getCurrentWeather') {
          const locArg = String((fnCalls[0].args as Record<string, unknown>)?.location || '');
          if (locArg) {
            const liveWeatherData = await fetchRealWeather(locArg);
            const prevContent = toolCheck.candidates?.[0]?.content;
            if (prevContent) {
              contentsCopy.push(prevContent as (typeof contentsCopy)[number]);
              contentsCopy.push({
                role: 'user',
                parts: [
                  {
                    text: `[Live Weather Data for ${locArg}]: ${JSON.stringify(liveWeatherData)}. Answer in 1-2 natural spoken sentences without symbols.`,
                  },
                ],
              });
            }
          }
        } else if (toolCheck.text?.trim()) {
          return {
            replyText: cleanTextForServerSpeech(toolCheck.text.trim()),
            usedModel: model,
          };
        }
      }

      const response = await ai.models.generateContent({
        model,
        contents: contentsCopy,
        config: {
          systemInstruction,
          ...(model === 'gemini-3.1-flash-lite'
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
            : model.startsWith('gemini-3')
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
        },
      });

      const text = cleanTextForServerSpeech(response.text || '');
      if (text) {
        return { replyText: text, usedModel: model };
      }
    } catch (err) {
      lastError = err;
      // Try next model in fallback chain
    }
  }

  throw lastError || new Error('All configured Gemini models failed to respond.');
}

async function synthesizeJarvisAudio(
  ai: GoogleGenAI,
  spokenText: string
): Promise<{ audioBase64?: string; ttsError?: string }> {
  try {
    const ttsResponse = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ text: spokenText.slice(0, 1200) }],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Charon' },
          },
        },
      },
    });

    const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return { ttsError: 'No audio data returned by TTS model.' };
    }
    return { audioBase64: base64Audio };
  } catch (err) {
    return {
      ttsError: err instanceof Error ? err.message : 'TTS generation failed.',
    };
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '1mb' }));

  // 1. Health Endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    const ai = getGenAIClient();
    const model = getPrimaryModel();
    res.json({
      ok: Boolean(ai),
      configured: Boolean(ai),
      model,
      ttsModel: TTS_MODEL,
      message: ai ? 'FIK AI ONLINE' : 'GEMINI_API_KEY missing on server',
    });
  });

  // 2. Complete Voice-to-Voice Turn Endpoint (Generates Reply + Real Gemini WAV Audio)
  app.post('/api/voice-turn', async (req: Request, res: Response) => {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'local';
    const rateStatus = checkRateLimit(clientIp);
    if (!rateStatus.allowed) {
      res.status(429).json({
        error: `Rate limit reached. Please wait ${rateStatus.retryAfterSec} seconds.`,
      });
      return;
    }

    const ai = getGenAIClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is missing on the server.',
      });
      return;
    }

    const formattedContents = validateAndFormatMessages(req.body?.messages);
    if (!formattedContents) {
      res.status(400).json({ error: 'Valid non-empty messages array required.' });
      return;
    }

    const clientTimeInfo =
      typeof req.body?.clientTimeInfo === 'string'
        ? req.body.clientTimeInfo.slice(0, 160)
        : new Date().toISOString();

    const systemInstructionWithTime = `${FIK_AI_VOICE_SYSTEM_INSTRUCTION}\nCurrent system time: ${clientTimeInfo}.`;

    try {
      const { replyText, usedModel } = await generateReplyWithFallback(
        ai,
        formattedContents,
        systemInstructionWithTime
      );

      // Generate real 24kHz mono 16-bit WAV audio from gemini-3.8-flash-lite-tts
      const { audioBase64, ttsError } = await synthesizeJarvisAudio(ai, replyText);

      res.json({
        replyText,
        audioBase64,
        mimeType: audioBase64 ? 'audio/wav' : undefined,
        model: usedModel,
        ttsError,
      });
    } catch (err) {
      const classified = classifyApiError(err);
      res.status(classified.status).json({ error: classified.message });
    }
  });

  // 3. Dedicated TTS Endpoint
  app.post('/api/tts', async (req: Request, res: Response) => {
    const ai = getGenAIClient();
    if (!ai) {
      res.status(503).json({ error: 'GEMINI_API_KEY missing.' });
      return;
    }

    const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!rawText) {
      res.status(400).json({ error: 'Text required.' });
      return;
    }

    const { audioBase64, ttsError } = await synthesizeJarvisAudio(
      ai,
      cleanTextForServerSpeech(rawText)
    );
    if (!audioBase64) {
      res.status(500).json({ error: ttsError || 'No audio generated.' });
      return;
    }

    res.json({ audioBase64, mimeType: 'audio/wav' });
  });

  // 4. Streaming Chat Endpoint (SSE) with model fallback
  app.post('/api/chat', async (req: Request, res: Response) => {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'local';
    const rateStatus = checkRateLimit(clientIp);
    if (!rateStatus.allowed) {
      res.status(429).json({
        error: `Rate limit reached. Wait ${rateStatus.retryAfterSec}s.`,
      });
      return;
    }

    const ai = getGenAIClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is missing on the server.',
      });
      return;
    }

    const formattedContents = validateAndFormatMessages(req.body?.messages);
    if (!formattedContents) {
      res.status(400).json({ error: 'Valid messages array required.' });
      return;
    }

    const clientTimeInfo =
      typeof req.body?.clientTimeInfo === 'string'
        ? req.body.clientTimeInfo.slice(0, 160)
        : new Date().toISOString();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let isClientDisconnected = false;
    req.on('close', () => {
      isClientDisconnected = true;
    });

    const sendSSE = (eventData: Record<string, unknown>) => {
      if (!isClientDisconnected && !res.writableEnded) {
        res.write(`data: ${JSON.stringify(eventData)}\n\n`);
      }
    };

    const systemInstructionWithTime = `${FIK_AI_VOICE_SYSTEM_INSTRUCTION}\nCurrent system time: ${clientTimeInfo}.`;

    const modelsToTry = getModelFallbackChain();
    let succeeded = false;
    let lastError: unknown = null;

    for (const model of modelsToTry) {
      if (isClientDisconnected) break;
      try {
        const streamResponse = await ai.models.generateContentStream({
          model,
          contents: formattedContents,
          config: {
            systemInstruction: systemInstructionWithTime,
            ...(model === 'gemini-3.1-flash-lite'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
              : model.startsWith('gemini-3')
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        });

        for await (const chunk of streamResponse) {
          if (isClientDisconnected) break;
          const c = chunk as GenerateContentResponse;
          const textChunk = c.text;
          if (textChunk) {
            succeeded = true;
            sendSSE({ type: 'delta', text: textChunk, model });
          }
        }

        if (succeeded) {
          sendSSE({ type: 'done', model });
          res.end();
          return;
        }
      } catch (err) {
        lastError = err;
        if (succeeded) break;
      }
    }

    if (!isClientDisconnected && !res.writableEnded) {
      const classified = classifyApiError(lastError);
      sendSSE({ type: 'error', error: classified.message });
      res.end();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FIK AI Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
