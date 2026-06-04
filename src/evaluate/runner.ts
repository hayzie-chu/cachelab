// Query replay engine scaffold.
import type { CacheLabClient } from "../client";
import type { QueryResult } from "../types";

export interface ReplayResult<TValue = unknown> {
	query: string;
	result: QueryResult<TValue>;
}

export async function runReplay<TValue>(
	client: CacheLabClient<TValue>,
	queries: ReadonlyArray<string>,
): Promise<Array<ReplayResult<TValue>>> {
	void client;
	void queries;
	throw new Error("runReplay is not implemented yet.");
}
