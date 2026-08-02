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
        record: notImplemented,
		getAll: notImplemented,
		getById: notImplemented,
		clear: notImplemented,
        getCount: notImplemented,
		getHitRate: notImplemented,
		getMissRate: notImplemented,
		getAverageLatency: notImplemented,
        getTotalTokensSaved: notImplemented,
        getTotalTimeSaved: notImplemented,
	} satisfies MetricAdapter<TValue>;
}

export type PostgresMetricEntry<TValue = unknown> = MetricEntry<TValue>;
