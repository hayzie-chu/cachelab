// OpenAI embeddings adapter scaffold.
import type { EmbeddingAdapter } from "./types";

export interface OpenAIEmbeddingAdapterOptions {
	apiKey: string;
	model?: string;
	baseUrl?: string;
}

interface OpenAIEmbeddingResponse {
	data: Array<{
		embedding: number[];
	}>;
}

export function createOpenAIEmbeddingAdapter(
	options: OpenAIEmbeddingAdapterOptions,
): EmbeddingAdapter {
	void options;
	return {
		async embed(input: string): Promise<Array<number>> {
			throw new Error("createOpenAIEmbeddingAdapter is not implemented yet.");
		},
	};
}
