import pino from 'pino';
import { ILLMProvider } from './types';
import { AnthropicProvider } from './anthropicProvider';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';
import { MockProvider } from './mockProvider';

const logger = pino();

export class ProviderFactory {
  /**
   * Resolves and instantiates the configured LLM provider
   */
  static getProvider(explicitProvider?: string): ILLMProvider {
    const providerName = (explicitProvider || process.env.LLM_PROVIDER || '').toLowerCase();

    try {
      // 1. Explicit configuration handling
      switch (providerName) {
        case 'anthropic':
          if (process.env.ANTHROPIC_API_KEY) {
            return new AnthropicProvider();
          }
          logger.warn('LLM_PROVIDER is "anthropic" but ANTHROPIC_API_KEY is missing; falling back to mock');
          return new MockProvider();

        case 'openai':
          if (process.env.OPENAI_API_KEY) {
            return new OpenAICompatibleProvider({
              name: 'openai',
              apiKey: process.env.OPENAI_API_KEY,
              model: process.env.OPENAI_MODEL || 'gpt-4o',
            });
          }
          logger.warn('LLM_PROVIDER is "openai" but OPENAI_API_KEY is missing; falling back to mock');
          return new MockProvider();

        case 'ollama':
          return new OpenAICompatibleProvider({
            name: 'ollama',
            baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
            apiKey: process.env.OLLAMA_API_KEY || 'ollama',
            model: process.env.OLLAMA_MODEL || 'llama3.2',
          });

        case 'groq':
          if (process.env.GROQ_API_KEY) {
            return new OpenAICompatibleProvider({
              name: 'groq',
              baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
              apiKey: process.env.GROQ_API_KEY,
              model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            });
          }
          logger.warn('LLM_PROVIDER is "groq" but GROQ_API_KEY is missing; falling back to mock');
          return new MockProvider();

        case 'deepseek':
          if (process.env.DEEPSEEK_API_KEY) {
            return new OpenAICompatibleProvider({
              name: 'deepseek',
              baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
              apiKey: process.env.DEEPSEEK_API_KEY,
              model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
            });
          }
          logger.warn('LLM_PROVIDER is "deepseek" but DEEPSEEK_API_KEY is missing; falling back to mock');
          return new MockProvider();

        case 'openrouter':
          if (process.env.OPENROUTER_API_KEY) {
            return new OpenAICompatibleProvider({
              name: 'openrouter',
              baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
              apiKey: process.env.OPENROUTER_API_KEY,
              model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',
            });
          }
          logger.warn('LLM_PROVIDER is "openrouter" but OPENROUTER_API_KEY is missing; falling back to mock');
          return new MockProvider();

        case 'custom':
          return new OpenAICompatibleProvider({
            name: 'custom',
            baseURL: process.env.CUSTOM_LLM_BASE_URL || 'http://localhost:8000/v1',
            apiKey: process.env.CUSTOM_LLM_API_KEY || 'custom',
            model: process.env.CUSTOM_LLM_MODEL || 'custom-model',
          });

        case 'mock':
          return new MockProvider();
      }

      // 2. Automatic key-based detection when LLM_PROVIDER is not set
      if (process.env.ANTHROPIC_API_KEY) {
        return new AnthropicProvider();
      }

      if (process.env.OPENAI_API_KEY) {
        return new OpenAICompatibleProvider({
          name: 'openai',
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL || 'gpt-4o',
        });
      }

      if (process.env.GROQ_API_KEY) {
        return new OpenAICompatibleProvider({
          name: 'groq',
          baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
          apiKey: process.env.GROQ_API_KEY,
          model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        });
      }

      if (process.env.DEEPSEEK_API_KEY) {
        return new OpenAICompatibleProvider({
          name: 'deepseek',
          baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
          apiKey: process.env.DEEPSEEK_API_KEY,
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        });
      }

      if (process.env.OPENROUTER_API_KEY) {
        return new OpenAICompatibleProvider({
          name: 'openrouter',
          baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
          apiKey: process.env.OPENROUTER_API_KEY,
          model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',
        });
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to initialize requested LLM provider; falling back to mock');
    }

    return new MockProvider();
  }
}
