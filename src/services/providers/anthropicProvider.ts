import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { ILLMProvider, LLMGenerateOptions } from './types';

const logger = pino();

export class AnthropicProvider implements ILLMProvider {
  public readonly name = 'anthropic';
  public readonly model: string;
  private client: Anthropic;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('AnthropicProvider requires ANTHROPIC_API_KEY');
    }
    this.model = model || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
    this.client = new Anthropic({ apiKey: key });
    logger.info({ provider: this.name, model: this.model }, 'Anthropic provider initialized');
  }

  async generate(options: LLMGenerateOptions): Promise<string> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.2,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: options.query }]
    });

    const firstBlock = message.content[0];
    if (firstBlock && firstBlock.type === 'text') {
      return firstBlock.text;
    }
    return '';
  }

  async stream(options: LLMGenerateOptions, onChunk: (chunk: string) => void): Promise<void> {
    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.2,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: options.query }]
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        onChunk(chunk.delta.text);
      }
    }
  }
}
