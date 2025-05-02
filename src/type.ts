
type ApiType = 'Azure' | 'Openai' | 'Ollama'

export interface LLMConfig {
  model: string;
  baseURL?: string;
  apiKey?: string;
  temperature?: number;
  apiType?: ApiType
}