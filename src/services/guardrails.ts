/**
 * Guardrails Module
 * Input validation, output sanitization, and deterministic safety checks for AI requests
 */
import { AppError } from '../utils/errors';
import pino from 'pino';

const logger = pino();

export const CONFIG = {
  maxInputLength: parseInt(process.env.GUARDRAIL_MAX_INPUT || '10000', 10),
  maxOutputLength: parseInt(process.env.GUARDRAIL_MAX_OUTPUT || '50000', 10),
  maxContextTokens: parseInt(process.env.GUARDRAIL_MAX_CONTEXT_TOKENS || '4000', 10),
};

const BLOCKED_PATTERNS = [
  { pattern: /<script[\s>]|javascript:|on\w+=/i, reason: 'Potential script injection' },
  { pattern: /union\s+select|insert\s+into|drop\s+table/i, reason: 'Potential SQL injection' },
  { pattern: /\b(system_prompt|ignore\s+previous\s+instructions)\b/i, reason: 'Prompt injection attempt' },
];

const DANGEROUS_TOPICS = [
  'suicide', 'self-harm', 'harm others', 'violence', 'abuse children',
  'illegal drug manufacturing', 'weaponry', 'explosives',
];

export interface ValidationOptions {
  skipHtml?: boolean;
}

function createError(code: string, message: string, retry: boolean = false) {
  return new AppError(message, 400, code, retry);
}

export function validateInput(text: any, options: ValidationOptions = {}): boolean {
  if (!text) {
    throw createError('E_VALIDATION', 'Input is required');
  }

  const input = typeof text === 'string' ? text : JSON.stringify(text);

  if (input.trim().length === 0) {
    throw createError('E_VALIDATION', 'Input cannot be empty');
  }

  if (input.length > CONFIG.maxInputLength) {
    throw createError('E_VALIDATION', `Input exceeds ${CONFIG.maxInputLength} char limit`);
  }

  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(input)) {
      logger.warn({ reason, snippet: input.slice(0, 100) }, 'Blocked input pattern');
      throw createError('E_GUARDRAIL', `Blocked: ${reason}`, false);
    }
  }

  const lower = input.toLowerCase();
  for (const topic of DANGEROUS_TOPICS) {
    if (lower.includes(topic)) {
      logger.warn({ topic }, 'Blocked dangerous topic');
      throw createError('E_GUARDRAIL', `Topic not allowed: ${topic}`, false);
    }
  }

  if (options.skipHtml) {
    const htmlPattern = /<script[\s>]|javascript:|on\w+=/i;
    if (htmlPattern.test(input)) {
      throw createError('E_VALIDATION', 'HTML/scripts not allowed');
    }
  }

  return true;
}

export function validateSchema(payload: any, requiredFields: string[]): boolean {
  if (!payload || typeof payload !== 'object') {
    throw createError('E_VALIDATION', 'Invalid request payload');
  }

  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null) {
      throw createError('E_VALIDATION', `Missing required field: ${field}`);
    }
  }

  return true;
}

export interface UserContextOptions {
  skipAuth?: boolean;
  checkQuota?: boolean;
}

export function validateUserContext(user: any, options: UserContextOptions = {}): boolean {
  if (!options.skipAuth) {
    if (!user || !user.id) {
      throw new AppError('Authentication required', 401, 'E_UNAUTHORIZED', false);
    }
  }

  if (options.checkQuota && user.quota && user.quota.remaining <= 0) {
    throw new AppError('Quota exceeded', 429, 'E_RATE_LIMITED', true);
  }

  return true;
}

export function truncateContext(context: string, maxTokens: number = CONFIG.maxContextTokens): string {
  if (!context) return '';

  const maxChars = maxTokens * 4;
  if (context.length > maxChars) {
    logger.warn({ originalLength: context.length, truncatedTo: maxChars }, 'Context truncated');
    return context.slice(0, maxChars) + '\n\n[truncated due to length limit]';
  }
  return context;
}

export function sanitizeOutput(output: string): string {
  if (!output) return '';

  let cleaned = output;

  // Strip code block wrappers if inappropriately wrapped
  cleaned = cleaned.replace(/^```(json|javascript|python)?\s*[\n\r]/gi, '');
  cleaned = cleaned.replace(/```\s*$/gm, '');
  cleaned = cleaned.replace(/^```\s*[\n\r]/gi, '');
  cleaned = cleaned.replace(/```$/gm, '');

  // Strip thinking / internal monologue blocks
  cleaned = cleaned.replace(/<(thought|reasoning|internal_monologue)>[\s\S]*?<\/\1>/gi, '');
  cleaned = cleaned.replace(/<(thought|reasoning|internal_monologue)>[\s\S]*/gi, '');
  cleaned = cleaned.replace(/<unused\d+>/gi, '');

  cleaned = cleaned.trim();

  if (cleaned.length > CONFIG.maxOutputLength) {
    cleaned = cleaned.slice(0, CONFIG.maxOutputLength) + '\n[output truncated]';
  }

  return cleaned;
}

export interface SafetyProfile {
  hardConstraints: string[];
  prohibitedEntities?: string[];
}

export interface SafetyCheckResult {
  safe: boolean;
  issues: string[];
}

/**
 * Deterministic Semantic Guardrail:
 * Validates generated advice against knowledge-graph constraints and high-risk directives.
 */
export function validateSafety(
  advice: string, 
  safetyProfile: SafetyProfile
): SafetyCheckResult {
  const issues: string[] = [];
  const lowerAdvice = advice.toLowerCase();

  // 1. High-risk instruction patterns (adversarial / jailbreak bypasses)
  const DANGEROUS_RECS = [
    'ignore safety',
    'override warnings',
    'bypass protocols',
    'disregard contraindications',
    'ignore previous constraints'
  ];

  for (const rec of DANGEROUS_RECS) {
    if (lowerAdvice.includes(rec)) {
      issues.push(`Advice contains high-risk directive: '${rec}'`);
    }
  }

  // 2. Positive recommendation of prohibited actions/substances
  // Checks if the response actively encourages or recommends things forbidden by constraints
  for (const constraint of safetyProfile.hardConstraints) {
    const cLower = constraint.toLowerCase();

    // Extract prohibited keywords from constraints like "avoid NSAIDs like ibuprofen" or "contraindicated: ibuprofen"
    const avoidMatch = cLower.match(/(?:avoid|contraindicated|do not take|prohibited|no)\s+([a-z0-9_\-\s]+)/i);
    if (avoidMatch && avoidMatch[1]) {
      const targetEntity = avoidMatch[1].trim();
      const entityTokens = targetEntity.split(/\s+/).filter(t => t.length > 3 && !['like', 'with', 'such', 'patient'].includes(t));

      for (const token of entityTokens) {
        // Detect affirmative recommendation patterns: "take ibuprofen", "you can use ibuprofen", "recommend ibuprofen"
        const positivePattern = new RegExp(`\\b(take|administer|use|prescribe|recommend(?:ed)?)\\s+(?:a\\s+|an\\s+|some\\s+)?(?:dose\\s+of\\s+)?${token}\\b`, 'i');
        
        // Ensure it's not preceded by a negation: "do not take ibuprofen", "cannot recommend ibuprofen", "avoid ibuprofen"
        const negationPattern = new RegExp(`\\b(do\\s+not|never|avoid|contraindicated|cannot\\s+recommend|should\\s+not)\\s+(?:take|administer|use|prescribe|recommend(?:ed)?\\s+)?(?:a\\s+|an\\s+)?${token}\\b`, 'i');

        if (positivePattern.test(lowerAdvice) && !negationPattern.test(lowerAdvice)) {
          issues.push(`Advice actively recommends '${token}', which violates constraint: "${constraint}"`);
        }
      }
    }
  }

  // 3. Prohibited entities direct check
  if (safetyProfile.prohibitedEntities) {
    for (const entity of safetyProfile.prohibitedEntities) {
      const entLower = entity.toLowerCase();
      const positivePattern = new RegExp(`\\b(take|use|administer|prescribe)\\s+${entLower}\\b`, 'i');
      if (positivePattern.test(lowerAdvice)) {
        issues.push(`Advice promotes restricted entity: '${entity}'`);
      }
    }
  }

  return {
    safe: issues.length === 0,
    issues
  };
}
