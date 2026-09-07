import pino from 'pino';
import Anthropic from '@anthropic-ai/sdk';
import { circuitManager } from '../utils/circuitBreaker';

const logger = pino();

export interface RagContextData {
  vectorContext?: Array<{ id: string; content: string; similarity?: number }>;
  constraints?: string[];
}

export interface RagRequest {
  query: string;
  contextData?: RagContextData;
}

export class AIService {
  private llmBreaker = circuitManager.getBreaker('anthropic-llm', { failureThreshold: 3, timeout: 20000 });
  private client: Anthropic | null = null;
  private provider: 'anthropic' | 'mock';

  constructor() {
    this.provider = (process.env.LLM_PROVIDER as 'anthropic' | 'mock') || 
      (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock');

    if (process.env.ANTHROPIC_API_KEY && this.provider === 'anthropic') {
      try {
        this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        logger.info('Anthropic SDK client initialized');
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Failed to initialize Anthropic client; falling back to mock provider');
        this.provider = 'mock';
      }
    } else {
      logger.info('AIService operating in deterministic mock mode (set ANTHROPIC_API_KEY to enable live generation)');
    }
  }

  async generateResponse(request: RagRequest): Promise<string> {
    logger.info({ query: request.query, provider: this.provider }, 'Generating response');

    return this.llmBreaker.execute(async () => {
      const constraints = request.contextData?.constraints || [];
      const vectorDocs = request.contextData?.vectorContext || [];

      // 1. Live Anthropic Generation
      if (this.client && this.provider === 'anthropic') {
        const systemPrompt = [
          'You are SafetyGraph Verified Assistant, an enterprise AI with deterministic safety constraints.',
          'You must strictly adhere to the following hard constraints retrieved from the Knowledge Graph:',
          constraints.length > 0 
            ? constraints.map((c, i) => `  ${i + 1}. [MANDATORY CONSTRAINT] ${c}`).join('\n')
            : '  (No specific hard constraints active for this query)',
          '',
          'Semantic context retrieved from Vector Search:',
          vectorDocs.length > 0 
            ? vectorDocs.map(d => `- ${d.content}`).join('\n')
            : '  (No vector context retrieved)',
          '',
          'Never advise or suggest any action that violates the mandatory constraints.'
        ].join('\n');

        const message = await this.client.messages.create({
          model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: request.query }]
        });

        const firstBlock = message.content[0];
        if (firstBlock && firstBlock.type === 'text') {
          return firstBlock.text;
        }
        return '';
      }

      // 2. Deterministic Mock Fallback (Clean, safe, reproducible)
      if (constraints.length > 0) {
        const constraintSummaries = constraints.map(c => `• ${c}`).join('\n');
        return `Based on verified safety constraints, the requested action cannot be recommended:\n${constraintSummaries}\n\nPlease follow domain-specific guidelines or consult a specialist.`;
      }

      if (vectorDocs.length > 0) {
        const primaryDoc = vectorDocs[0].content;
        return `According to verified reference material: ${primaryDoc}`;
      }

      return `SafetyGraph processed your inquiry: "${request.query}". No safety violations or contraindications were identified.`;
    });
  }

  async streamResponse(request: RagRequest, onChunk: (chunk: string) => void): Promise<void> {
    logger.info({ query: request.query }, 'Streaming response');

    await this.llmBreaker.execute(async () => {
      const fullResponse = await this.generateResponse(request);
      const words = fullResponse.split(' ');
      for (const word of words) {
        onChunk(word + ' ');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    });
  }
}

export const aiService = new AIService();
