// LLM adapter contract.
export interface LLMAdapter<TValue = string> {
	generate(prompt: string): Promise<TValue>;
}