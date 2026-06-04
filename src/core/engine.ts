// Cache hit and miss decision logic.
import { cosineSimilarity, meetsThreshold } from "./similarity";
import type { CacheEntry, CacheDecision } from "../types";

export function decideCacheHit<TValue>(
	queryEmbedding: ReadonlyArray<number>,
	entries: ReadonlyArray<CacheEntry<TValue>>,
	threshold = 0.85,
): CacheDecision<TValue> {
	void queryEmbedding;
	void entries;
	void threshold;
	void cosineSimilarity;
	void meetsThreshold;
	throw new Error("decideCacheHit is not implemented yet.");
}
