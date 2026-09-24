import { cleanEnv, str, num, port } from 'envalid';
import 'dotenv/config';

export function validateEnv(envSource: Record<string, string | undefined> = process.env) {
  return cleanEnv(envSource, {
    NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
    PORT: port({ default: 4000 }),

    // Neo4j Configuration
    NEO4J_URI: str({ default: 'neo4j://localhost:7687' }),
    NEO4J_USER: str({ default: 'neo4j' }),
    NEO4J_PASSWORD: str({ default: 'password' }),

    // PostgreSQL / pgvector Configuration
    POSTGRES_HOST: str({ default: 'localhost' }),
    POSTGRES_PORT: port({ default: 5432 }),
    POSTGRES_USER: str({ default: 'postgres' }),
    POSTGRES_PASSWORD: str({ default: 'password' }),
    POSTGRES_DB: str({ default: 'safetygraph' }),
    DATABASE_URL: str({ default: '' }),

    // Redis Configuration
    REDIS_URL: str({ default: '' }),
    REDIS_HOST: str({ default: 'localhost' }),
    REDIS_PORT: port({ default: 6379 }),
    CACHE_TTL_SECONDS: num({ default: 3600 }),

    // LLM Provider Configuration
    LLM_PROVIDER: str({ default: 'mock' }),
    ANTHROPIC_API_KEY: str({ default: '' }),
    ANTHROPIC_MODEL: str({ default: 'claude-3-5-sonnet-20241022' }),
    OPENAI_API_KEY: str({ default: '' }),
    OPENAI_MODEL: str({ default: 'gpt-4o' }),
    OPENAI_EMBEDDING_MODEL: str({ default: 'text-embedding-3-small' }),
    OLLAMA_BASE_URL: str({ default: 'http://localhost:11434/v1' }),
    OLLAMA_MODEL: str({ default: 'llama3.2' }),
    OLLAMA_API_KEY: str({ default: 'ollama' }),
    GROQ_API_KEY: str({ default: '' }),
    GROQ_BASE_URL: str({ default: 'https://api.groq.com/openai/v1' }),
    GROQ_MODEL: str({ default: 'llama-3.3-70b-versatile' }),
    DEEPSEEK_API_KEY: str({ default: '' }),
    DEEPSEEK_BASE_URL: str({ default: 'https://api.deepseek.com/v1' }),
    DEEPSEEK_MODEL: str({ default: 'deepseek-chat' }),
    OPENROUTER_API_KEY: str({ default: '' }),
    OPENROUTER_BASE_URL: str({ default: 'https://openrouter.ai/api/v1' }),
    OPENROUTER_MODEL: str({ default: 'anthropic/claude-3.5-sonnet' }),
    CUSTOM_LLM_BASE_URL: str({ default: 'http://localhost:8000/v1' }),
    CUSTOM_LLM_API_KEY: str({ default: 'custom' }),
    CUSTOM_LLM_MODEL: str({ default: 'custom-model' }),

    // Guardrail Limits
    GUARDRAIL_MAX_INPUT: num({ default: 10000 }),
    GUARDRAIL_MAX_OUTPUT: num({ default: 50000 }),
    GUARDRAIL_MAX_CONTEXT_TOKENS: num({ default: 4000 }),

    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: num({ default: 900000 }),
    RATE_LIMIT_MAX: num({ default: 100 }),
  }, {
    reporter: ({ errors }) => {
      const errorMap = errors as Record<string, any>;
      const errorKeys = Object.keys(errorMap);
      if (errorKeys.length > 0) {
        const details = errorKeys.map(k => `${k}: ${errorMap[k]?.message || errorMap[k]}`).join(', ');
        throw new Error(`Environment validation failed: ${details}`);
      }
    }
  });
}

export const env = validateEnv();
