/**
 * 🧠 AI-Assisted README Analyzer
 *
 * Uses a fast AI model to extract semantic meaning from README files.
 * Supports Anthropic (Claude Haiku) and OpenRouter (free models).
 * Falls back gracefully to local-only parsing if no API key available.
 *
 * Created by Paul Cowen's fork - the Pauly Engine.
 */

/**
 * Result from AI README analysis
 */
export interface AIReadmeResult {
  description: string;
  who: string | null;
  what: string | null;
  why: string | null;
  where: string | null;
  when: string | null;
  how: string | null;
  topics: string[];
  projectType: string | null;
  source: 'anthropic' | 'openrouter' | 'local';
}

/**
 * Detect which API key is available
 */
function detectProvider(): { provider: 'anthropic' | 'openrouter' | null; apiKey: string | null } {
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { provider: 'openrouter', apiKey: process.env.OPENROUTER_API_KEY };
  }
  return { provider: null, apiKey: null };
}

/**
 * Analyze README with AI to extract semantic context
 *
 * @param readmeContent - The full README.md content
 * @param languages - Detected language strings (e.g. "C++ (44.3%)")
 * @param projectName - Detected project name
 * @returns Structured context or null if AI unavailable
 */
export async function analyzeReadmeWithAI(
  readmeContent: string,
  languages: string[],
  projectName: string
): Promise<AIReadmeResult | null> {
  const { provider, apiKey } = detectProvider();

  if (!provider || !apiKey) {
    return null; // No API key - caller should use local parsing
  }

  // Truncate README to ~4000 chars to keep costs minimal
  const truncatedReadme = readmeContent.substring(0, 4000);

  const prompt = `Analyze this README and extract structured information. Return ONLY valid JSON, no markdown.

PROJECT NAME: ${projectName}
DETECTED LANGUAGES: ${languages.join(', ') || 'Unknown'}

README CONTENT:
${truncatedReadme}

Return this exact JSON structure (use null for fields you can't determine):
{
  "description": "One sentence describing what this project does",
  "who": "Target users/audience (e.g. 'Developers building speech recognition apps')",
  "what": "Core problem it solves or what it provides",
  "why": "Motivation or purpose behind the project",
  "where": "Where it runs or is deployed (e.g. 'Cross-platform, runs locally')",
  "when": "Timeline, version info, or roadmap status",
  "how": "How to get started or how it works (one sentence)",
  "topics": ["topic1", "topic2", "topic3"],
  "projectType": "One of: cli, library, web-app, api, mobile-app, desktop-app, framework, tool, plugin, data-science, devops, or null"
}`;

  try {
    if (provider === 'anthropic') {
      return await callAnthropic(apiKey, prompt);
    } else {
      return await callOpenRouter(apiKey, prompt);
    }
  } catch (error) {
    // Silently fail - AI analysis is optional
    return null;
  }
}

/**
 * Call Anthropic Claude Haiku
 */
async function callAnthropic(apiKey: string, prompt: string): Promise<AIReadmeResult | null> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return parseAIResponse(text, 'anthropic');
}

/**
 * Call OpenRouter (supports free models)
 * Tries models in order of capability for structured JSON extraction
 */
const OPENROUTER_FREE_MODELS = [
  'google/gemma-3-12b-it:free',                // Reliable, good at JSON
  'google/gemma-3-27b-it:free',                // Best quality when available
  'meta-llama/llama-3.3-70b-instruct:free',    // Strong but often rate-limited
  'mistralai/mistral-small-3.1-24b-instruct:free', // Good fallback
  'nvidia/nemotron-nano-9b-v2:free',           // NVIDIA fallback
  'google/gemma-3-4b-it:free',                 // Lightweight fallback
  'openrouter/free',                           // Auto-router as last resort
];

async function callOpenRouter(apiKey: string, prompt: string): Promise<AIReadmeResult | null> {
  for (const model of OPENROUTER_FREE_MODELS) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://faf.one',
          'X-Title': 'FAF CLI',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
        }),
      });

      if (!response.ok) continue; // Try next model

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (!text) continue; // Empty response, try next

      const result = parseAIResponse(text, 'openrouter');
      if (result) return result; // Success!
    } catch {
      continue; // Try next model
    }
  }
  return null; // All models failed
}

/**
 * Parse the AI response JSON
 */
function parseAIResponse(text: string, source: 'anthropic' | 'openrouter'): AIReadmeResult | null {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    // Also handle case where response starts with { directly
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1) {
      jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
    }

    const parsed = JSON.parse(jsonStr);

    return {
      description: parsed.description || '',
      who: parsed.who || null,
      what: parsed.what || null,
      why: parsed.why || null,
      where: parsed.where || null,
      when: parsed.when || null,
      how: parsed.how || null,
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      projectType: parsed.projectType || null,
      source,
    };
  } catch {
    return null;
  }
}
