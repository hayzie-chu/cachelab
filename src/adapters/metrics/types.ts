// Metric database adapter contract.
import type { MetricEntry } from "../../types";

export type MetricsFilter = {
	source?: 'cache' | 'origin';
	minThreshold?: number;
	maxThreshold?: number;
	after?: Date;
	before?: Date;
};

export interface MetricAdapter<TValue = unknown> {
    // For internal use, e.g: invoke()
	record(entry: MetricEntry): Promise<void>;

    // For testing
	getAll(filter?: MetricsFilter): Promise<MetricEntry[]>;
	getById(id: string): Promise<MetricEntry | null>;
	clear(): Promise<void>;

    // Business logic function 
	getCount(filter?: MetricsFilter): Promise<number>;
	getHitRate(filter?: MetricsFilter): Promise<number>;
	getMissRate(filter?: MetricsFilter): Promise<number>;
	getAverageLatency(filter?: MetricsFilter): Promise<number>;
	getTotalTokensSaved(filter?: MetricsFilter): Promise<number>;
	getTotalTimeSaved(filter?: MetricsFilter): Promise<number>;
    
}
