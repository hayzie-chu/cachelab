// Main CacheLab client entry point.
import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "./adapters/db/types";
import type { EmbeddingAdapter } from "./adapters/embeddings/types";
import type { MetricAdapter } from "./adapters/metrics/types";
import type { CacheEntry, QueryResult } from "./types";

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
		const queryEmbedding = await this.options.embeddingAdapter.embed(options.query);
		const decision = await this.options.dbAdapter.findBestMatch(queryEmbedding, threshold);

		if (decision.hit && decision.entry) {
			const cachedEntry = decision.entry;
			const refreshedEntry: CacheEntry<TValue> = {
				...cachedEntry,
				hits: cachedEntry.hits + 1,
				updatedAt: new Date().toISOString(),
			};

			await this.options.dbAdapter.upsert(refreshedEntry);

			return {
				data: cachedEntry.value,
				source: "cache",
				decision,
				cachedAt: cachedEntry.createdAt,
			};
		}

		const data = await options.compute();
		const timestamp = new Date().toISOString();
		const cachedEntry: CacheEntry<TValue> = {
			id: randomUUID(),
			query: options.query,
			embedding: queryEmbedding,
			value: data,
			createdAt: timestamp,
			updatedAt: timestamp,
			hits: 0,
			metadata: options.metadata,
		};

		await this.options.dbAdapter.upsert(cachedEntry);

		return {
			data,
			source: "origin",
			decision,
		};
	}
}
