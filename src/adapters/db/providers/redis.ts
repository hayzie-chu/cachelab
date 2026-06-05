// Redis database adapter scaffold.
import type { CacheDecision, CacheEntry } from "../../../types";
import type { DatabaseAdapter } from "../types";

export interface RedisDatabaseAdapterOptions {
	connectionString: string;
	keyPrefix?: string;
}

export function createRedisDatabaseAdapter<TValue>(
	_options: RedisDatabaseAdapterOptions,
): DatabaseAdapter<TValue> {
	const notImplemented = async (): Promise<never> => {
		throw new Error("Redis adapter is not implemented yet.");
	};

	const searchNotImplemented = async (): Promise<CacheDecision<TValue>> => {
		throw new Error("Redis adapter search is not implemented yet.");
	};

	return {
		findBestMatch: searchNotImplemented,
		getAll: notImplemented,
		getById: notImplemented,
		upsert: notImplemented,
		remove: notImplemented,
		clear: notImplemented,
	} satisfies DatabaseAdapter<TValue>;
}

export type RedisCacheEntry<TValue = unknown> = CacheEntry<TValue>;
