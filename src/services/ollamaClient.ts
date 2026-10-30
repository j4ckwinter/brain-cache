import { Ollama } from 'ollama';

export function getOllamaHost(): string {
  return process.env.OLLAMA_HOST ?? 'http://localhost:11434';
}

export function getOllamaClient(): Ollama {
  return new Ollama({ host: getOllamaHost() });
}
