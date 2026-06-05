// Metric database adapter contract.
import type { MetricEntry } from "../../types";

export interface MetricAdapter<TValue = unknown> {
    getAll(): Promise<Array<MetricEntry<TValue>>>;
    getById(id: string): Promise<MetricEntry<TValue> | undefined>;
    upsert(entry: MetricEntry<TValue>): Promise<void>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
}
