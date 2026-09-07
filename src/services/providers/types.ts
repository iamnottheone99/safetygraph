export interface LLMGenerateOptions {
  query: string;
  systemPrompt: string;
  maxTokens?: number;
  temperature?: number;
  constraints?: string[];
  vectorDocs?: Array<{ id: string; content: string; similarity?: number }>;
}

export interface ILLMProvider {
  readonly name: string;
  readonly model: string;
  generate(options: LLMGenerateOptions): Promise<string>;
  stream(options: LLMGenerateOptions, onChunk: (chunk: string) => void): Promise<void>;
}
