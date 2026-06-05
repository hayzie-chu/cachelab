// Public API surface for CacheLab.

export { CacheLabClient } from "./client";

export type { CacheEntry, QueryResult, MetricEntry } from "./types";

export { createPostgresDatabaseAdapter } from "./adapters/db/postgres";

export { createOpenAIEmbeddingAdapter } from "./adapters/embeddings/openai";

export { createPostgresMetricsStoreAdapter } from "./adapters/metrics/postgres";

// export {
//     createRedisDatabaseAdapter,
// } from "./adapters/db/redis";

// export {
//     createInMemoryDatabaseAdapter,
// } from "./adapters/db/redis";