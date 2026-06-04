// Postgres pgvector database adapter scaffold.
import type { CacheEntry } from "../../types";
import type { DatabaseAdapter } from "./types";

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

	return {
		getAll: notImplemented,
		getById: notImplemented,
		upsert: notImplemented,
		remove: notImplemented,
		clear: notImplemented,
	} satisfies DatabaseAdapter<TValue>;
}

export type PostgresCacheEntry<TValue = unknown> = CacheEntry<TValue>;