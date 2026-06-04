// Database adapter contract.
import type { CacheEntry } from "../../types";

export interface DatabaseAdapter<TValue = unknown> {
	getAll(): Promise<Array<CacheEntry<TValue>>>;
	getById(id: string): Promise<CacheEntry<TValue> | undefined>;
	upsert(entry: CacheEntry<TValue>): Promise<void>;
	remove(id: string): Promise<void>;
	clear(): Promise<void>;
}