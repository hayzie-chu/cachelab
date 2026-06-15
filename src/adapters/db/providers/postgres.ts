// Postgres pgvector database adapter scaffold.
import type { CacheDecision, CacheEntry } from "../../../types";
import type { DatabaseAdapter } from "../types";
import { Pool } from "pg";

export interface PostgresDatabaseAdapterOptions {
	connectionString: string;
	tableName?: string;
}

export function createPostgresDatabaseAdapter<TValue>(
	options: PostgresDatabaseAdapterOptions,
): DatabaseAdapter<TValue> {
	const pool = new Pool({
		connectionString: options.connectionString,
	});

	const notImplemented = async (): Promise<never> => {
		throw new Error("Postgres adapter is not implemented yet.");
	};

	return {
		findBestMatch: notImplemented,
		getAll: notImplemented,
		getById: notImplemented,
		upsert: notImplemented,
		remove: notImplemented,
		clear: notImplemented,
	} satisfies DatabaseAdapter<TValue>;
}

export type PostgresCacheEntry<TValue = unknown> = CacheEntry<TValue>;
