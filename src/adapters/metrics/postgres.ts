// Postgres pgvector database adapter scaffold.
import type { MetricEntry } from "../../types";
import type { MetricAdapter } from "./types";

export interface PostgresMetricsStoreAdapterOptions {
	connectionString: string;
	tableName?: string;
}

export function createPostgresMetricsStoreAdapter<TValue>(
	_options: PostgresMetricsStoreAdapterOptions,
): MetricAdapter<TValue> {
	const notImplemented = async (): Promise<never> => {
		throw new Error("Postgres metric store is not implemented yet.");
	};

	return {
		getAll: notImplemented,
		getById: notImplemented,
		upsert: notImplemented,
		remove: notImplemented,
		clear: notImplemented,
	} satisfies MetricAdapter<TValue>;
}

export type PostgresMetricEntry<TValue = unknown> = MetricEntry<TValue>;
