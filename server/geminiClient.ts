import { GoogleGenAI } from '@google/genai';

let geminiClient: GoogleGenAI | null = null;
let lastUsedKey: string | null = null;
let knownInvalidApiKey: string | null = null;
let isValidatedUsable: boolean | null = null;
let keyValidationPromise: Promise<boolean> | null = null;
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
  if (isValidatedUsable === false && lastUsedKey === key) {
    return false;
  }
  return true;
}

/**
 * Asynchronously verifies if the configured GEMINI_API_KEY is accepted by Google GenAI.
 * Returns true if valid, false if revoked/invalid/unauthorized.
 */
export async function verifyGeminiApiKey(): Promise<boolean> {
  const rawKey = process.env.GEMINI_API_KEY;
  if (!rawKey) return false;
  const cleanKey = rawKey.trim().replace(/^["']|["']$/g, '');

  if (lastUsedKey === cleanKey && isValidatedUsable !== null) {
    return isValidatedUsable;
  }
  if (keyValidationPromise) {
    return keyValidationPromise;
  }

  keyValidationPromise = (async () => {
    try {
      const client = new GoogleGenAI({
        apiKey: cleanKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const probeCall = client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: '1' }] }],
      });
      probeCall.catch(() => {});

      let timer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TIMEOUT')), 3500);
      });

      await Promise.race([probeCall, timeoutPromise]);
      if (timer) clearTimeout(timer);

      isValidatedUsable = true;
      lastUsedKey = cleanKey;
      return true;
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (
        msg.includes('API_KEY_INVALID') ||
        msg.includes('API key not valid') ||
        msg.includes('PERMISSION_DENIED') ||
        err?.status === 400 ||
        err?.status === 403
      ) {
        knownInvalidApiKey = cleanKey;
        isValidatedUsable = false;
        lastUsedKey = cleanKey;
        console.log('[GeminiClient] Configured GEMINI_API_KEY is invalid/unauthorized. Heuristic & rule-based engine will be used automatically.');
        return false;
      }
      // If temporary timeout or 503, don't permanently invalidate
      return true;
    } finally {
      keyValidationPromise = null;
    }
  })();

  return keyValidationPromise;
}

// Proactively test key in background
if (process.env.GEMINI_API_KEY) {
  verifyGeminiApiKey().catch(() => {});
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
        errMsg.includes('PERMISSION_DENIED') ||
        err?.status === 400 ||
        err?.status === 403
      ) {
        if (lastUsedKey) {
          knownInvalidApiKey = lastUsedKey;
          isValidatedUsable = false;
        }
        geminiClient = null;
        console.log('[GeminiClient] GEMINI_API_KEY is invalid or unauthorized; using rule-based/heuristic fallbacks.');
        throw new Error('GEMINI_API_KEY_INVALID: API key is invalid or unauthorized.');
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
