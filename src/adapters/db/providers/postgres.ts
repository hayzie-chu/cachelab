// Postgres pgvector database adapter scaffold.
import type { CacheDecision, CacheEntry } from "../../../types";
import type { DatabaseAdapter } from "../types";

export interface PostgresDatabaseAdapterOptions {
	connectionString: string;
	tableName?: string;
}

export function createPostgresDatabaseAdapter<TValue>(
	_options: PostgresDatabaseAdapterOptions,
): DatabaseAdapter<TValue> {
	const notImplemented = async (): Promise<never> => {
		throw new Error("Postgres adapter is not implemented yet.");
	};

	const searchNotImplemented = async (): Promise<CacheDecision<TValue>> => {
		throw new Error("Postgres adapter search is not implemented yet.");
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

export type PostgresCacheEntry<TValue = unknown> = CacheEntry<TValue>;
