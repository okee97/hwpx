import { GoogleGenAI } from '@google/genai';

let geminiClient: GoogleGenAI | null = null;
let lastUsedKey: string | null = null;
let knownInvalidApiKey: string | null = null;
const modelUnhealthyUntil: Record<string, number> = {};

export function isGeminiKeyConfigured(): boolean {
  const rawKey = process.env.GEMINI_API_KEY;
  if (!rawKey) return false;
  const key = rawKey.trim().replace(/^["']|["']$/g, '');
  if (
    !key ||
    key === 'MY_GEMINI_API_KEY' ||
    key === 'YOUR_API_KEY' ||
    key.startsWith('MY_GEMINI') ||
    key.length < 10
  ) {
    return false;
  }
  if (knownInvalidApiKey && knownInvalidApiKey === key) {
    return false;
  }
  return true;
}

export function getGeminiClient(): GoogleGenAI | null {
  if (!isGeminiKeyConfigured()) {
    return null;
  }
  const rawKey = process.env.GEMINI_API_KEY!.trim().replace(/^["']|["']$/g, '');
  if (!geminiClient || lastUsedKey !== rawKey) {
    lastUsedKey = rawKey;
    geminiClient = new GoogleGenAI({
      apiKey: rawKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

export function markModelTemporarilyUnavailable(model: string, cooldownMs: number = 60000) {
  modelUnhealthyUntil[model] = Date.now() + cooldownMs;
}

export function isModelHealthy(model: string): boolean {
  return !(modelUnhealthyUntil[model] && modelUnhealthyUntil[model] > Date.now());
}

export interface GenerateContentPayload {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  config?: {
    responseMimeType?: string;
    temperature?: number;
  };
}

/**
 * Resilient Gemini Content Generation with Smart Circuit Breaker & Failover.
 * - Attaches safe rejection handlers so timed-out API calls never cause UnhandledPromiseRejection crashes.
 * - Prioritizes currently healthy models to avoid repetitive 503 UNAVAILABLE / high-demand wait times.
 * - Handles 503 / 429 / timeout gracefully by switching to alternative models.
 * - Detects invalid API key / quota limits fast and falls back cleanly without server crashes.
 */
export async function generateContentWithFallback(
  payload: GenerateContentPayload,
  models: string[] = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'],
  timeoutMs: number = 12000
): Promise<{ text: string; modelUsed: string }> {
  const client = getGeminiClient();
  if (!client) {
    throw new Error('GEMINI_API_KEY is not configured or is invalid.');
  }

  // Sort candidate models so currently healthy models are attempted first
  const candidateModels = [...models].sort((a, b) => {
    const aHealthy = isModelHealthy(a) ? 1 : 0;
    const bHealthy = isModelHealthy(b) ? 1 : 0;
    return bHealthy - aHealthy;
  });

  let lastError: any = null;

  for (let i = 0; i < candidateModels.length; i++) {
    const model = candidateModels[i];
    let timer: NodeJS.Timeout | null = null;
    try {
      const apiCall = client.models.generateContent({
        model,
        contents: payload.contents,
        config: payload.config,
      });

      // CRITICAL: Attach a noop error handler so if timeout wins the race,
      // the late rejection from apiCall does NOT cause an UnhandledPromiseRejection process crash.
      apiCall.catch(() => {});

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Model '${model}' timed out after ${timeoutMs}ms (high demand)`));
        }, timeoutMs);
      });

      const response = await Promise.race([apiCall, timeoutPromise]);
      const text = response.text || '';
      return { text, modelUsed: model };
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);

      // If it's an authorization/invalid key error, mark key as invalid to prevent repeated spam
      if (
        errMsg.includes('API_KEY_INVALID') ||
        errMsg.includes('API key not valid') ||
        errMsg.includes('PERMISSION_DENIED')
      ) {
        if (lastUsedKey) {
          knownInvalidApiKey = lastUsedKey;
        }
        geminiClient = null;
        console.warn('[GeminiClient] API key invalid or unauthorized; using rule-based/heuristic fallbacks.');
        throw err;
      }

      const isTransientOrUnavailable =
        errMsg.includes('503') ||
        errMsg.includes('high demand') ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.includes('429') ||
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('temporarily unavailable') ||
        errMsg.includes('timed out') ||
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('ECONNRESET');

      if (isTransientOrUnavailable) {
        markModelTemporarilyUnavailable(model, 60000);
        if (i < candidateModels.length - 1) {
          console.warn(
            `[GeminiClient] Model '${model}' experienced high demand (503/429/timeout). Switching to '${candidateModels[i + 1]}' (${i + 1}/${candidateModels.length})...`
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  throw lastError || new Error('All candidate Gemini models failed.');
}
