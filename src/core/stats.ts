// Stats object builder.
import type { Stats } from "../types";

export interface StatsInput {
	hits: number;
	misses: number;
	similarities: ReadonlyArray<number>;
}

export function buildStats(input: StatsInput): Stats {
	void input;
	throw new Error("buildStats is not implemented yet.");
}