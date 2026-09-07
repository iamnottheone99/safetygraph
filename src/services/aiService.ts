import pino from 'pino';
import { circuitManager } from '../utils/circuitBreaker';
import { ILLMProvider } from './providers/types';
import { ProviderFactory } from './providers/providerFactory';

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
  private llmBreaker = circuitManager.getBreaker('llm-provider', { failureThreshold: 3, timeout: 20000 });
  private provider: ILLMProvider;

  constructor(customProvider?: ILLMProvider) {
    this.provider = customProvider || ProviderFactory.getProvider();
    logger.info({ provider: this.provider.name, model: this.provider.model }, 'AIService ready');
  }

  /**
   * Set or switch active provider dynamically
   */
  setProvider(provider: ILLMProvider): void {
    this.provider = provider;
    logger.info({ provider: this.provider.name, model: this.provider.model }, 'Switched active LLM provider');
  }

  getProviderInfo(): { name: string; model: string } {
    return {
      name: this.provider.name,
      model: this.provider.model
    };
  }

  /**
   * Build the structured system prompt integrating vector search and graph constraints
   */
  private buildSystemPrompt(constraints: string[], vectorDocs: Array<{ id: string; content: string }>): string {
    return [
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
  }

  async generateResponse(request: RagRequest): Promise<string> {
    logger.info({
      query: request.query,
      provider: this.provider.name,
      model: this.provider.model
    }, 'Generating response');

    return this.llmBreaker.execute(async () => {
      const constraints = request.contextData?.constraints || [];
      const vectorDocs = request.contextData?.vectorContext || [];
      const systemPrompt = this.buildSystemPrompt(constraints, vectorDocs);

      return this.provider.generate({
        query: request.query,
        systemPrompt,
        constraints,
        vectorDocs
      });
    });
  }

  async streamResponse(request: RagRequest, onChunk: (chunk: string) => void): Promise<void> {
    logger.info({
      query: request.query,
      provider: this.provider.name,
      model: this.provider.model
    }, 'Streaming response');

    await this.llmBreaker.execute(async () => {
      const constraints = request.contextData?.constraints || [];
      const vectorDocs = request.contextData?.vectorContext || [];
      const systemPrompt = this.buildSystemPrompt(constraints, vectorDocs);

      await this.provider.stream({
        query: request.query,
        systemPrompt,
        constraints,
        vectorDocs
      }, onChunk);
    });
  }
}

export const aiService = new AIService();
