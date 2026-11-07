import { evaluateFaithfulness, MetricResult } from './evalService';
/**
 * Guardrails Module
 * Input validation, output sanitization, and deterministic safety checks for AI requests
 */
import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { systemOneService, SystemOneSafetyEvaluation } from './systemOneService';
import pino from 'pino';

const logger = pino();

export const CONFIG = {
  maxInputLength: env.GUARDRAIL_MAX_INPUT,
  maxOutputLength: env.GUARDRAIL_MAX_OUTPUT,
  maxContextTokens: env.GUARDRAIL_MAX_CONTEXT_TOKENS,
};

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BLOCKED_PATTERNS = [
  { pattern: /<script[\s>]|javascript:|on\w+=/i, reason: 'Potential script injection' },
  {
    pattern: /(?:;|\bunion\s+select|\binsert\s+into|\bdrop\s+table\b)/i,
    reason: 'Potential SQL injection',
  },
  {
    pattern:
      /\b(system_prompt|ignore\s+(?:all\s+)?previous\s+instructions|disregard\s+(?:all\s+)?prior\s+instructions|you\s+are\s+now\s+in\s+developer\s+mode|dan\s+mode|bypass\s+safety\s+filter)\b/i,
    reason: 'Prompt injection attempt',
  },
];

const DANGEROUS_TOPICS = [
  'suicide',
  'self-harm',
  'harm others',
  'violence',
  'abuse children',
  'illegal drug manufacturing',
  'weaponry',
  'explosives',
];

function createError(code: string, message: string, retry: boolean = false) {
  return new AppError(message, 400, code, retry);
}

export function validateInput(text: any): boolean {
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

  // Word-boundary sensitive matching for dangerous topics to prevent broad false-positive substring matches
  for (const topic of DANGEROUS_TOPICS) {
    const topicPattern = new RegExp(`\\b${escapeRegex(topic)}\\b`, 'i');
    if (topicPattern.test(input)) {
      logger.warn({ topic }, 'Blocked dangerous topic');
      throw createError('E_GUARDRAIL', `Topic not allowed: ${topic}`, false);
    }
  }

  return true;
}

export function truncateContext(
  context: string,
  maxTokens: number = CONFIG.maxContextTokens
): string {
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
  retrievedContext?: string[];
  availableDocIds?: string[];
  enforceFaithfulness?: boolean;
}

export interface CitationVerification {
  citedIds: string[];
  validCitations: string[];
  invalidCitations: string[];
  isGrounded: boolean;
}

/**
 * Extracts and verifies [doc_id] citations against available document IDs
 */
export function extractAndVerifyCitations(
  response: string,
  availableDocIds: string[] = []
): CitationVerification {
  if (!response) {
    return { citedIds: [], validCitations: [], invalidCitations: [], isGrounded: true };
  }

  const citationRegex = /\[([a-zA-Z0-9_\-.:]{3,64})\]/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = citationRegex.exec(response)) !== null) {
    const id = match[1];
    if (id !== 'truncated' && id !== 'MANDATORY' && !id.startsWith('http')) {
      found.add(id);
    }
  }

  const citedIds = Array.from(found);
  const availableSet = new Set(availableDocIds);
  const validCitations = citedIds.filter((id) => availableSet.has(id));
  const invalidCitations = citedIds.filter((id) => !availableSet.has(id));

  return {
    citedIds,
    validCitations,
    invalidCitations,
    isGrounded: invalidCitations.length === 0,
  };
}

export interface SafetyCheckResult {
  safe: boolean;
  issues: string[];
}

/**
 * Deterministic Semantic Guardrail:
 * Validates generated advice against knowledge-graph constraints and high-risk directives.
 */
export function validateSafety(advice: string, safetyProfile: SafetyProfile): SafetyCheckResult {
  const issues: string[] = [];
  const lowerAdvice = advice.toLowerCase();

  // 1. High-risk instruction patterns (adversarial / jailbreak bypasses)
  const DANGEROUS_RECS = [
    'ignore safety',
    'override warnings',
    'bypass protocols',
    'disregard contraindications',
    'ignore previous constraints',
  ];

  for (const rec of DANGEROUS_RECS) {
    if (lowerAdvice.includes(rec)) {
      issues.push(`Advice contains high-risk directive: '${rec}'`);
    }
  }

  // 2. Positive recommendation of prohibited actions/substances
  for (const constraint of safetyProfile.hardConstraints) {
    const cLower = constraint.toLowerCase();

    // Extract prohibited keywords from constraints like "avoid NSAIDs like ibuprofen" or "contraindicated: ibuprofen"
    const avoidMatch = cLower.match(
      /(?:avoid|contraindicated|do not take|prohibited|no)\s+([a-z0-9_\-\s,]+)/i
    );
    if (avoidMatch && avoidMatch[1]) {
      const targetEntity = avoidMatch[1].trim();
      const entityTokens = targetEntity
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(
          (t) =>
            t.length > 3 &&
            !['like', 'with', 'such', 'patient', 'disease', 'condition', 'severe'].includes(t)
        );

      for (const rawToken of entityTokens) {
        const token = escapeRegex(rawToken);

        // Pattern A: Active verb before entity: "take ibuprofen", "prescribe ibuprofen", "recommend ibuprofen"
        const activePattern = new RegExp(
          `\\b(take|administer|use|prescribe|recommend(?:ed)?|suggest(?:ed)?|give|given)\\s+(?:a\\s+|an\\s+|some\\s+)?(?:dose\\s+of\\s+)?${token}\\b`,
          'i'
        );

        // Pattern B: Predicate recommendation: "ibuprofen is recommended", "ibuprofen is suitable", "ibuprofen is effective"
        const predicatePattern = new RegExp(
          `\\b${token}\\s+(?:is|are)\\s+(?:recommended|suggested|suitable|effective|indicated|advised|prescribed)\\b`,
          'i'
        );

        // Pattern C: Noun recommendation: "suggested medication: ibuprofen", "recommended analgesic: ibuprofen"
        const nounPattern = new RegExp(
          `\\b(recommendation|suggested|recommended|prescribed)\\s+(?:option|medication|drug|analgesic|treatment)?\\s*[:\\-]?\\s*${token}\\b`,
          'i'
        );

        // Negation / safe pattern: "do not take ibuprofen", "avoid ibuprofen", "ibuprofen is contraindicated", "never prescribe ibuprofen"
        const negationPattern = new RegExp(
          `(?:\\b(do\\s+not|never|avoid|contraindicated|cannot\\s+recommend|should\\s+not)\\s+(?:take|administer|use|prescribe|recommend(?:ed)?\\s+)?(?:a\\s+|an\\s+)?${token}\\b|\\b${token}\\s+(?:is|are)\\s+(?:contraindicated|not\\s+recommended|strictly\\s+avoided|prohibited)\\b)`,
          'i'
        );

        const isRecommending =
          activePattern.test(lowerAdvice) ||
          predicatePattern.test(lowerAdvice) ||
          nounPattern.test(lowerAdvice);
        const isNegated = negationPattern.test(lowerAdvice);

        if (isRecommending && !isNegated) {
          issues.push(
            `Advice actively recommends '${rawToken}', which violates constraint: "${constraint}"`
          );
        }
      }
    }
  }

  // 3. Prohibited entities direct check
  if (safetyProfile.prohibitedEntities) {
    for (const entity of safetyProfile.prohibitedEntities) {
      const entLower = escapeRegex(entity.toLowerCase());
      const positivePattern = new RegExp(
        `\\b(take|use|administer|prescribe|recommend)\\s+${entLower}\\b`,
        'i'
      );
      const negationPattern = new RegExp(
        `\\b(do\\s+not|never|avoid|contraindicated)\\s+(?:take|use|administer|prescribe)?\\s*${entLower}\\b`,
        'i'
      );

      if (positivePattern.test(lowerAdvice) && !negationPattern.test(lowerAdvice)) {
        issues.push(`Advice promotes restricted entity: '${entity}'`);
      }
    }
  }

  return {
    safe: issues.length === 0,
    issues,
  };
}

/**
 * Hybrid Semantic & Deterministic Guardrail:
 * Combines Tier 1 in-memory regex with Tier 2 System One semantic evaluation (Ollama decision models).
 */
export async function validateSafetyAsync(
  advice: string,
  safetyProfile: SafetyProfile
): Promise<SafetyCheckResult & { evaluationMetadata?: SystemOneSafetyEvaluation; faithfulness?: MetricResult }> {
  // 1. Tier 1: Fast in-memory regex check (<1ms)
  const syncResult = validateSafety(advice, safetyProfile);
  if (!syncResult.safe) {
    return {
      ...syncResult,
      evaluationMetadata: {
        safe: false,
        violatesConstraints: true,
        violationProbability: 1.0,
        severity: 'critical',
        severityConfidence: 1.0,
        jailbreakDetected: false,
        latencyMs: 0,
        evaluatedBy: 'regex_fallback',
        modelUsed: 'regex-engine',
        issues: syncResult.issues,
      },
    };
  }

  // 2. Tier 2: System One decision engine semantic check
  if (env.SYSTEM_ONE_ENABLED && safetyProfile.hardConstraints.length > 0) {
    try {
      const decisionResult = await systemOneService.evaluateSafety(
        advice,
        safetyProfile.hardConstraints
      );
      if (!decisionResult.safe) {
        return {
          safe: false,
          issues: decisionResult.issues,
          evaluationMetadata: decisionResult,
        };
      }
      return {
        safe: true,
        issues: [],
        evaluationMetadata: decisionResult,
      };
    } catch (err: any) {
      logger.warn(
        { err: err.message },
        'System One evaluation failed / circuit tripped; falling back to regex result'
      );
      return {
        ...syncResult,
        evaluationMetadata: {
          safe: syncResult.safe,
          violatesConstraints: false,
          violationProbability: 0,
          severity: 'none',
          severityConfidence: 0,
          jailbreakDetected: false,
          latencyMs: 0,
          evaluatedBy: 'regex_fallback',
          modelUsed: 'regex-engine',
          issues: syncResult.issues,
        },
      };
    }
  }

  // 3. Faithfulness context verification (if context provided)
  let faithfulnessMetric: any = undefined;
  if (safetyProfile.retrievedContext && safetyProfile.retrievedContext.length > 0) {
    const faith = evaluateFaithfulness(
      advice,
      safetyProfile.retrievedContext,
      safetyProfile.hardConstraints
    );
    faithfulnessMetric = {
      score: faith.score,
      passed: faith.passed,
      reason: faith.reason,
    };
    if (!faith.passed && safetyProfile.enforceFaithfulness) {
      return {
        safe: false,
        issues: [`Output failed faithfulness verification: ${faith.reason}`],
        faithfulness: faithfulnessMetric,
      };
    }
  }

  return {
    ...syncResult,
    faithfulness: faithfulnessMetric,
  };
}
