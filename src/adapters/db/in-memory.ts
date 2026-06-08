// In-memory database adapter scaffold.
import type { CacheDecision, CacheEntry } from "../../types";
import type { DatabaseAdapter } from "./types";

export class InMemoryDatabaseAdapter<TValue = string> implements DatabaseAdapter<TValue> {
	private entries: Array<CacheEntry<TValue>>;

	constructor(seed: ReadonlyArray<CacheEntry<TValue>> = []) {
		this.entries = seed.map(cloneEntry);
	}

	async findBestMatch(
		queryEmbedding: ReadonlyArray<number>,
		threshold: number,
	): Promise<CacheDecision<TValue>> {
		let bestEntry: CacheEntry<TValue> | undefined;
		let bestSimilarity = 0;

		for (const entry of this.entries) {
			const similarity = cosineSimilarity(queryEmbedding, entry.embedding);

			if (bestEntry === undefined || similarity > bestSimilarity) {
				bestEntry = entry;
				bestSimilarity = similarity;
			}
		}

		if (bestEntry === undefined) {
			return {
				hit: false,
				similarity: 0,
				threshold,
				entry: undefined,
				reason: "no-candidate",
			};
		}

		if (meetsThreshold(bestSimilarity, threshold)) {
			return {
				hit: true,
				similarity: bestSimilarity,
				threshold,
				entry: cloneEntry(bestEntry),
				reason: "threshold-met",
			};
		}

		return {
			hit: false,
			similarity: bestSimilarity,
			threshold,
			entry: undefined,
			reason: "threshold-not-met",
		};
	}

	async getAll(): Promise<Array<CacheEntry<TValue>>> {
		return this.entries.map(cloneEntry);
	}

	async getById(id: string): Promise<CacheEntry<TValue> | undefined> {
		const entry = this.entries.find((candidate) => candidate.id === id);

		return entry ? cloneEntry(entry) : undefined;
	}

	async upsert(entry: CacheEntry<TValue>): Promise<void> {
		const nextEntry = cloneEntry(entry);
		const existingIndex = this.entries.findIndex((candidate) => candidate.id === entry.id);

		if (existingIndex === -1) {
			this.entries.push(nextEntry);
			return;
		}

		this.entries[existingIndex] = nextEntry;
	}

	async remove(id: string): Promise<void> {
		this.entries = this.entries.filter((entry) => entry.id !== id);
	}

	async clear(): Promise<void> {
		this.entries = [];
	}
}

export function createInMemoryDatabaseAdapter<TValue = string>(
	seed: ReadonlyArray<CacheEntry<TValue>> = [],
): DatabaseAdapter<TValue> {
	return new InMemoryDatabaseAdapter(seed);
}

function cloneEntry<TValue>(entry: CacheEntry<TValue>): CacheEntry<TValue> {
	return {
		...entry,
		embedding: [...entry.embedding],
		metadata: entry.metadata ? { ...entry.metadata } : undefined,
	};
}

function cosineSimilarity(left: ReadonlyArray<number>, right: ReadonlyArray<number>): number {
	if (left.length === 0 || right.length === 0 || left.length !== right.length) {
		return 0;
	}

	let dotProduct = 0;
	let leftMagnitudeSquared = 0;
	let rightMagnitudeSquared = 0;

	for (let index = 0; index < left.length; index += 1) {
		const leftValue = left[index];
		const rightValue = right[index];

		dotProduct += leftValue * rightValue;
		leftMagnitudeSquared += leftValue * leftValue;
		rightMagnitudeSquared += rightValue * rightValue;
	}

	if (leftMagnitudeSquared === 0 || rightMagnitudeSquared === 0) {
		return 0;
	}

	return dotProduct / (Math.sqrt(leftMagnitudeSquared) * Math.sqrt(rightMagnitudeSquared));
}

function meetsThreshold(similarity: number, threshold: number): boolean {
	return similarity >= threshold;
}
