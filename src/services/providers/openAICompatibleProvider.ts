import OpenAI from 'openai';
import pino from 'pino';
import { ILLMProvider, LLMGenerateOptions } from './types';

const logger = pino();

export interface OpenAICompatibleConfig {
  name: string;
  apiKey: string;
  baseURL?: string;
  model: string;
}

export class OpenAICompatibleProvider implements ILLMProvider {
  public readonly name: string;
  public readonly model: string;
  private client: OpenAI;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.name;
    this.model = config.model;

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });

    logger.info({
      provider: this.name,
      model: this.model,
      baseURL: config.baseURL || 'https://api.openai.com/v1'
    }, 'OpenAI-compatible provider initialized');
  }

  async generate(options: LLMGenerateOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.query }
      ],
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.2,
    });

    return response.choices[0]?.message?.content || '';
  }

  async stream(options: LLMGenerateOptions, onChunk: (chunk: string) => void): Promise<void> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.query }
      ],
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.2,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        onChunk(content);
      }
    }
  }
}
