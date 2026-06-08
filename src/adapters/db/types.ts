// Database adapter contract.
import type { CacheDecision, CacheEntry } from "../../types";

export interface DatabaseAdapter<TValue = unknown> {
	findBestMatch(
		queryEmbedding: ReadonlyArray<number>,
		threshold: number,
	): Promise<CacheDecision<TValue>>;

	getAll(): Promise<Array<CacheEntry<TValue>>>;
	getById(id: string): Promise<CacheEntry<TValue> | undefined>;
	upsert(entry: CacheEntry<TValue>): Promise<void>;
	remove(id: string): Promise<void>;
	clear(): Promise<void>;
}
