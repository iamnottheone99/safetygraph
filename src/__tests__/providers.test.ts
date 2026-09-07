import { MockProvider } from '../services/providers/mockProvider';
import { ProviderFactory } from '../services/providers/providerFactory';
import { OpenAICompatibleProvider } from '../services/providers/openAICompatibleProvider';
import { AnthropicProvider } from '../services/providers/anthropicProvider';
import { AIService } from '../services/aiService';

describe('LLM Providers Architecture', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_PROVIDER;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('MockProvider', () => {
    const mock = new MockProvider();

    test('should identify as mock provider', () => {
      expect(mock.name).toBe('mock');
      expect(mock.model).toBe('deterministic-mock-v1');
    });

    test('should synthesize response respecting constraints', async () => {
      const result = await mock.generate({
        query: 'Can I take ibuprofen?',
        systemPrompt: 'System instructions',
        constraints: ['Patient has severe asthma; avoid NSAIDs like ibuprofen'],
      });

      expect(result).toContain('cannot be recommended');
      expect(result).toContain('Patient has severe asthma');
    });

    test('should cite vector documents when present without constraints', async () => {
      const result = await mock.generate({
        query: 'What is acetaminophen?',
        systemPrompt: 'System instructions',
        vectorDocs: [{ id: 'doc_1', content: 'Acetaminophen is a safe analgesic' }],
      });

      expect(result).toContain('According to verified reference material');
      expect(result).toContain('Acetaminophen is a safe analgesic');
    });

    test('should stream chunks correctly', async () => {
      const chunks: string[] = [];
      await mock.stream(
        {
          query: 'Hello',
          systemPrompt: 'System',
        },
        (chunk) => chunks.push(chunk)
      );

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('')).toContain('SafetyGraph processed your inquiry');
    });
  });

  describe('ProviderFactory', () => {
    test('should return MockProvider when no keys or provider specified', () => {
      const provider = ProviderFactory.getProvider();
      expect(provider.name).toBe('mock');
    });

    test('should return Ollama OpenAICompatibleProvider when LLM_PROVIDER=ollama', () => {
      const provider = ProviderFactory.getProvider('ollama');
      expect(provider.name).toBe('ollama');
      expect(provider.model).toBe('llama3.2');
    });

    test('should return OpenAI provider when OPENAI_API_KEY is present', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key-mock';
      const provider = ProviderFactory.getProvider('openai');
      expect(provider.name).toBe('openai');
      expect(provider.model).toBe('gpt-4o');
    });

    test('should return Anthropic provider when ANTHROPIC_API_KEY is present', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-mock';
      const provider = ProviderFactory.getProvider('anthropic');
      expect(provider.name).toBe('anthropic');
      expect(provider.model).toBe('claude-3-5-sonnet-20241022');
    });

    test('should auto-detect Groq when GROQ_API_KEY is present', () => {
      process.env.GROQ_API_KEY = 'gsk-test-key-mock';
      const provider = ProviderFactory.getProvider();
      expect(provider.name).toBe('groq');
      expect(provider.model).toBe('llama-3.3-70b-versatile');
    });

    test('should auto-detect DeepSeek when DEEPSEEK_API_KEY is present', () => {
      process.env.DEEPSEEK_API_KEY = 'dsk-test-key-mock';
      const provider = ProviderFactory.getProvider();
      expect(provider.name).toBe('deepseek');
      expect(provider.model).toBe('deepseek-chat');
    });

    test('should auto-detect OpenRouter when OPENROUTER_API_KEY is present', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test-key-mock';
      const provider = ProviderFactory.getProvider();
      expect(provider.name).toBe('openrouter');
      expect(provider.model).toBe('anthropic/claude-3.5-sonnet');
    });

    test('should gracefully fall back to mock if requested provider lacks required key', () => {
      const provider = ProviderFactory.getProvider('anthropic'); // no key set
      expect(provider.name).toBe('mock');
    });
  });

  describe('AIService with Provider Architecture', () => {
    test('should allow dynamic provider switching', async () => {
      const service = new AIService(new MockProvider());
      expect(service.getProviderInfo().name).toBe('mock');

      const ollama = new OpenAICompatibleProvider({
        name: 'ollama',
        apiKey: 'ollama',
        model: 'mistral:latest',
        baseURL: 'http://localhost:11434/v1',
      });
      service.setProvider(ollama);
      expect(service.getProviderInfo().name).toBe('ollama');
      expect(service.getProviderInfo().model).toBe('mistral:latest');
    });

    test('should execute generation via active provider', async () => {
      const service = new AIService(new MockProvider());
      const response = await service.generateResponse({
        query: 'Treatment options for headache?',
        contextData: { constraints: ['Do not prescribe opioids'] },
      });

      expect(response).toContain('cannot be recommended');
      expect(response).toContain('Do not prescribe opioids');
    });
  });
});
