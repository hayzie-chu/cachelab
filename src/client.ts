// Main CacheLab client entry point.
import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "./adapters/db/types";
import {
	createBatchingEmbeddingAdapter,
	type BatchingEmbeddingAdapterOptions,
} from "./adapters/embeddings/batching";
import type { EmbeddingAdapter } from "./adapters/embeddings/types";
import type { MetricAdapter } from "./adapters/metrics/types";
import type { CacheEntry, QueryResult } from "./types";

export interface CacheLabClientOptions<TValue = string> {
	dbAdapter: DatabaseAdapter<TValue>;
	embeddingAdapter: EmbeddingAdapter;
	metricAdapter?: MetricAdapter<TValue>;
	/**
	 * Optional request-coalescing config for the end-user queries passed to
	 * `invoke`. When provided, individual query embeds are buffered and sent to
	 * the embedding provider in shared batches. Leave unset to embed each query
	 * immediately (lowest latency). Bulk `seed` uploads are batched
	 * independently of this setting.
	 */
	batching?: BatchingEmbeddingAdapterOptions;
}

export interface SeedEntry<TValue = string> {
	query: string;
	value: TValue;
	metadata?: Record<string, unknown>;
}

export interface SeedOptions {
	/**
	 * Embed the seed queries in batched requests. Defaults to `true`. Set to
	 * `false` to embed them one-by-one (e.g. to isolate a failing query).
	 */
	batch?: boolean;
}

export class CacheLabClient<TValue = string> {
	// Used for live `invoke` traffic; coalesces requests when batching is configured.
	private readonly liveEmbeddingAdapter: EmbeddingAdapter;

	constructor(public readonly options: CacheLabClientOptions<TValue>) {
		this.liveEmbeddingAdapter = options.batching
			? createBatchingEmbeddingAdapter(options.embeddingAdapter, options.batching)
			: options.embeddingAdapter;
	}

	async invoke(options: {
		query: string;
		compute: () => Promise<TValue>;
		threshold?: number;
		model?: string;
		metadata?: Record<string, unknown>;
	}): Promise<QueryResult<TValue>> {
		const threshold = options.threshold ?? 0.8;
		const queryEmbedding = await this.liveEmbeddingAdapter.embed(options.query);
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

	/**
	 * Loads an initial set of saved query/value pairs into the cache, embedding
	 * each query and storing it as a cache entry. Queries are embedded in
	 * batched requests by default; pass `{ batch: false }` to embed them
	 * individually. Seeding always uses the underlying embedding adapter
	 * directly — it bypasses the live `invoke` coalescing layer.
	 */
	async seed(
		entries: ReadonlyArray<SeedEntry<TValue>>,
		seedOptions?: SeedOptions,
	): Promise<void> {
		if (entries.length === 0) {
			return;
		}

		const shouldBatch = seedOptions?.batch ?? true;
		const adapter = this.options.embeddingAdapter;
		const queries = entries.map((entry) => entry.query);

		const embeddings = shouldBatch
			? await adapter.embedBatch(queries)
			: await embedSequentially(adapter, queries);

		const timestamp = new Date().toISOString();

		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const cacheEntry: CacheEntry<TValue> = {
				id: randomUUID(),
				query: entry.query,
				embedding: embeddings[index],
				value: entry.value,
				createdAt: timestamp,
				updatedAt: timestamp,
				hits: 0,
				metadata: entry.metadata,
			};

			await this.options.dbAdapter.upsert(cacheEntry);
		}
	}
}

async function embedSequentially(
	adapter: EmbeddingAdapter,
	queries: ReadonlyArray<string>,
): Promise<Array<Array<number>>> {
	const vectors: Array<Array<number>> = [];

	for (const query of queries) {
		vectors.push(await adapter.embed(query));
	}

	return vectors;
}
