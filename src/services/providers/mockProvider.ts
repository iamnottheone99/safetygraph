import pino from 'pino';
import { ILLMProvider, LLMGenerateOptions } from './types';

const logger = pino();

export class MockProvider implements ILLMProvider {
  public readonly name = 'mock';
  public readonly model = 'deterministic-mock-v1';

  constructor() {
    logger.info('Mock provider initialized (offline deterministic fallback)');
  }

  async generate(options: LLMGenerateOptions): Promise<string> {
    const constraints = options.constraints || [];
    const vectorDocs = options.vectorDocs || [];

    if (constraints.length > 0) {
      const constraintList = constraints.map(c => `• ${c}`).join('\n');
      return `Based on verified safety constraints, the requested action cannot be recommended:\n${constraintList}\n\nPlease follow domain-specific guidelines or consult a specialist.`;
    }

    if (vectorDocs.length > 0) {
      return `According to verified reference material: ${vectorDocs[0].content}`;
    }

    return `SafetyGraph processed your inquiry: "${options.query}". No safety violations or contraindications were identified.`;
  }

  async stream(options: LLMGenerateOptions, onChunk: (chunk: string) => void): Promise<void> {
    const fullResponse = await this.generate(options);
    const words = fullResponse.split(' ');
    for (const word of words) {
      onChunk(word + ' ');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}
