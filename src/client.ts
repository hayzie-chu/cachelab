// Main CacheLab client entry point.
import type { DatabaseAdapter } from "./adapters/db/types";
import type { EmbeddingAdapter } from "./adapters/embeddings/types";
import type { LLMAdapter } from "./adapters/llm/types";
import type { QueryResult } from "./types";

export interface CacheLabClientOptions<TValue = string> {
	dbAdapter: DatabaseAdapter<TValue>;
	embeddingAdapter: EmbeddingAdapter;
	llmAdapter?: LLMAdapter<TValue>;
	similarityThreshold?: number;
}

export class CacheLabClient<TValue = string> {
	constructor(public readonly options: CacheLabClientOptions<TValue>) {}

	async query(input: string): Promise<QueryResult<TValue>> {
		void input;
		void this.options;
		throw new Error("CacheLabClient.query is not implemented yet.");
	}
}
