// In-memory database adapter scaffold.
import type { CacheEntry } from "../../types";
import type { DatabaseAdapter } from "./types";

export class InMemoryDatabaseAdapter<TValue = string> implements DatabaseAdapter<TValue> {
	constructor(_seed: ReadonlyArray<CacheEntry<TValue>> = []) {}

	async getAll(): Promise<Array<CacheEntry<TValue>>> {
		throw new Error("InMemoryDatabaseAdapter.getAll is not implemented yet.");
	}

	async getById(_id: string): Promise<CacheEntry<TValue> | undefined> {
		throw new Error("InMemoryDatabaseAdapter.getById is not implemented yet.");
	}

	async upsert(_entry: CacheEntry<TValue>): Promise<void> {
		throw new Error("InMemoryDatabaseAdapter.upsert is not implemented yet.");
	}

	async remove(_id: string): Promise<void> {
		throw new Error("InMemoryDatabaseAdapter.remove is not implemented yet.");
	}

	async clear(): Promise<void> {
		throw new Error("InMemoryDatabaseAdapter.clear is not implemented yet.");
	}
}

export function createInMemoryDatabaseAdapter<TValue = string>(
	seed: ReadonlyArray<CacheEntry<TValue>> = [],
): DatabaseAdapter<TValue> {
	return new InMemoryDatabaseAdapter(seed);
}
