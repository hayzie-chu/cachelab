// OpenAI LLM adapter scaffold.
import type { LLMAdapter } from "./types";

export interface OpenAILLMAdapterOptions {
	apiKey: string;
	model?: string;
	baseUrl?: string;
}

interface OpenAIResponsePayload {
	output_text?: string;
}

export function createOpenAILLMAdapter(options: OpenAILLMAdapterOptions): LLMAdapter<string> {
	void options;
	return {
		async generate(_prompt: string): Promise<string> {
			throw new Error("createOpenAILLMAdapter is not implemented yet.");
		},
	};
}