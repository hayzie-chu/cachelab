// Public API surface for CacheLab.

export { CacheLabClient } from "./client";

export type {
	CacheLabClientOptions,
	SeedEntry,
	SeedOptions,
} from "./client";

export type { CacheDecision, CacheEntry, MetricEntry, QueryResult } from "./types";

export type { EmbeddingAdapter } from "./adapters/embeddings/types";

export {
	createBatchingEmbeddingAdapter,
	type BatchingEmbeddingAdapterOptions,
} from "./adapters/embeddings/batching";

export type { DatabaseAdapter } from "./adapters/db/types";

export { createInMemoryDatabaseAdapter } from "./adapters/db/in-memory";

export { createPostgresDatabaseAdapter } from "./adapters/db/providers/postgres";

export { createRedisDatabaseAdapter } from "./adapters/db/providers/redis";

export { createOpenAIEmbeddingAdapter } from "./adapters/embeddings/openai";

export { createPostgresMetricsStoreAdapter } from "./adapters/metrics/postgres";
