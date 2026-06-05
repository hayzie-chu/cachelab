// Shared cache and evaluation types.
export type CacheSource = "cache" | "origin";

export interface CacheEntry<TValue = unknown> {
	id: string;
	query: string;
	embedding: ReadonlyArray<number>;
	value: TValue;
	createdAt: string;
	updatedAt: string;
	hits: number;
	metadata?: Record<string, unknown>;
}

export interface MetricEntry {
	id: string;

	timestamp: string;
    
	hit: boolean;
	reason: "no-candidate" | "threshold-met" | "threshold-not-met";

	similarity: number;
	threshold: number;

	lookupLatencyMs: number;
	generationLatencyMs?: number;

	model?: string;
	db?: string;
	embeddingModel?: string;

	tokensSaved?: number;
	latencySavedMs?: number;

	metadata?: Record<string, unknown>;
}

export interface QueryResult<TValue = unknown> {
	data: TValue;
	source: CacheSource;
	cachedAt?: string;
}

export interface CacheDecision<TValue = unknown> {
	hit: boolean;
	similarity: number;
	threshold: number;
	entry?: CacheEntry<TValue>;
	reason: "no-candidate" | "threshold-met" | "threshold-not-met";
}

export interface Stats {
	hits: number;
	misses: number;
	total: number;
	hitRate: number;
	averageSimilarity: number;
	minSimilarity: number;
	maxSimilarity: number;
}
