// Main CacheLab client entry point.
import type { DatabaseAdapter } from "./adapters/db/types";
import type { EmbeddingAdapter } from "./adapters/embeddings/types";
import type { MetricAdapter } from "./adapters/metrics/types";
import type { QueryResult } from "./types";

export interface CacheLabClientOptions<TValue = string> {
	dbAdapter: DatabaseAdapter<TValue>;
	embeddingAdapter: EmbeddingAdapter;
	metricAdapter?: MetricAdapter<TValue>;
}

export class CacheLabClient<TValue = string> {
	constructor(public readonly options: CacheLabClientOptions<TValue>) {}

	async invoke(options: {
		query: string;
		compute: () => Promise<TValue>;
		threshold?: number;
		model?: string;
		metadata?: Record<string, unknown>;
	}): Promise<QueryResult<TValue>> {
		const threshold = options.threshold ?? 0.8;
		const model = options.model ?? "N/A";

		// TODO: Generate query embedding.

		// TODO: Retrieve candidate cache entries.

		// TODO: Determine cache hit/miss using threshold.

		// TODO: Record metrics.

		// TODO: Return cached value or compute new value.

		throw new Error("Not implemented");
	}
}
