import "dotenv/config";

import { createPineconeDatabaseAdapter } from "../../src/adapters/db/providers/pinecone";
import type { CacheEntry } from "../../src/types";

// Pinecone is eventually consistent
// a write is acknowledged before it is readable, 
// so reads are polled rather than asserted immediately.
const CONSISTENCY_TIMEOUT_MS = 60_000;
const CONSISTENCY_POLL_INTERVAL_MS = 500;

jest.setTimeout(5 * 60_000);

describe("PineconeDatabaseAdapter", () => {
	const apiKey = process.env.TEST_PINECONE_API_KEY;
	const indexName = process.env.TEST_PINECONE_INDEX ?? "cachelab-integration";
	// Isolate this suite from anything else living in the index.
	const namespace = process.env.TEST_PINECONE_NAMESPACE ?? "cachelab-integration-tests";

	let adapter: ReturnType<typeof createPineconeDatabaseAdapter>;

	const createAdapter = (): ReturnType<typeof createPineconeDatabaseAdapter> =>
		createPineconeDatabaseAdapter({
			apiKey: apiKey!,
			indexName,
			namespace,
			// Only used when the index does not exist yet.
			vectorDimensions: 3,
		});

	beforeEach(async () => {
		if (!apiKey) {
			throw new Error("TEST_PINECONE_API_KEY must be set for integration tests");
		}

		adapter = createAdapter();

		await adapter.initialize?.();
		await adapter.clear();
		await waitFor(async () => (await adapter.getAll()).length === 0);
	});

	afterEach(async () => {
		await adapter?.clear();
		await adapter?.close?.();
	});

	describe("entry persistence", () => {
		it("replaces an existing entry on upsert", async () => {
			const original: CacheEntry = {
				id: "entry-1",
				query: "hello",
				embedding: [1, 0, 0],
				value: { version: 1 },
				createdAt: "2026-08-25T00:00:00.000Z",
				updatedAt: "2026-08-25T00:00:00.000Z",
				hits: 0,
				metadata: {
					source: "original",
				},
			};

			await adapter.upsert(original);
			await waitForEntry(original.id);

			const updated: CacheEntry = {
				...original,
				query: "updated query",
				embedding: [0, 1, 0],
				value: { version: 2 },
				updatedAt: "2026-08-02T00:00:00.000Z",
				metadata: {
					source: "updated",
				},
			};

			await adapter.upsert(updated);

			const stored = await waitForEntry(
				original.id,
				(entry) => entry.query === updated.query,
			);

			expect(stored.createdAt).toBe(original.createdAt);
			expect(stored.updatedAt).toBe(updated.updatedAt);

			expect(stored.embedding).toEqual(updated.embedding);
			expect(stored.value).toEqual(updated.value);
			expect(stored.metadata).toEqual(updated.metadata);
		});

		it("supports entries without metadata", async () => {
			const entry: CacheEntry = {
				id: "entry-without-metadata",
				query: "hello",
				embedding: [1, 0, 0],
				value: {
					answer: 42,
				},
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
				hits: 0,
			};

			await adapter.upsert(entry);

			await expect(waitForEntry(entry.id)).resolves.toEqual(entry);
		});
	});

	describe("retrieval", () => {
		it("retrieves all stored entries with complete field fidelity", async () => {
			const entry: CacheEntry = {
				id: "entry-1",
				query: "complex query",
				embedding: [0.1, 0.2, 0.3],
				value: {
					nested: {
						array: [1, 2, 3],
						boolean: true,
						text: "hello",
					},
				},
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-02T00:00:00.000Z",
				hits: 7,
				metadata: {
					tags: ["a", "b"],
					nested: {
						x: 1,
					},
				},
			};

			await adapter.upsert(entry);

			const entries = await waitFor(async () => {
				const stored = await adapter.getAll();

				return stored.length === 1 ? stored : undefined;
			});

			// Pinecone stores float32, so the embedding comes back approximated.
			expect(entries[0].embedding.map((value) => Number(value.toFixed(5)))).toEqual(
				entry.embedding,
			);
			expect({ ...entries[0], embedding: entry.embedding }).toEqual(entry);
		});
	});

	describe("similarity search", () => {
		it("returns the nearest entry when it clears the threshold", async () => {
			const entry: CacheEntry = {
				id: "match-me",
				query: "how do I cache api responses",
				embedding: [1, 0, 0],
				value: "cached answer",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
				hits: 0,
			};

			await adapter.upsert(entry);
			await waitForEntry(entry.id);

			const decision = await waitFor(async () => {
				const result = await adapter.findBestMatch([0.99, 0.01, 0], 0.8);

				return result.hit ? result : undefined;
			});

			expect(decision.reason).toBe("threshold-met");
			expect(decision.similarity).toBeGreaterThan(0.8);
			expect(decision.entry?.id).toBe(entry.id);
			expect(decision.entry?.value).toBe(entry.value);
		});

		it("reports threshold-not-met for an orthogonal query", async () => {
			const entry: CacheEntry = {
				id: "no-match",
				query: "unrelated",
				embedding: [1, 0, 0],
				value: "cached answer",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
				hits: 0,
			};

			await adapter.upsert(entry);
			await waitForEntry(entry.id);

			const decision = await waitFor(async () => {
				const result = await adapter.findBestMatch([0, 1, 0], 0.8);

				return result.reason === "threshold-not-met" ? result : undefined;
			});

			expect(decision.hit).toBe(false);
			expect(decision.entry).toBeUndefined();
		});
	});

	describe("additional integration coverage", () => {
		it("persists entries across adapter instances", async () => {
			const entry: CacheEntry = {
				id: "persistent-entry",
				query: "persist me",
				embedding: [1, 0, 0],
				value: {
					test: true,
				},
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
				hits: 0,
			};

			await adapter.upsert(entry);
			await waitForEntry(entry.id);

			const secondAdapter = createAdapter();

			try {
				await expect(secondAdapter.getById(entry.id)).resolves.toEqual(entry);

				const updatedEntry: CacheEntry = {
					...entry,
					query: "persist me, updated",
					value: { test: false },
					updatedAt: "2025-02-01T00:00:00.000Z",
				};

				await secondAdapter.upsert(updatedEntry);

				const storedAfterUpdate = await waitForEntry(
					entry.id,
					(stored) => stored.query === updatedEntry.query,
				);

				expect(storedAfterUpdate).toEqual(updatedEntry);
			} finally {
				await secondAdapter.close?.();
			}
		});

		it("removes a single entry without touching the rest", async () => {
			const first: CacheEntry = {
				id: "keep-me",
				query: "keep",
				embedding: [1, 0, 0],
				value: "kept",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
				hits: 0,
			};

			const second: CacheEntry = { ...first, id: "drop-me", embedding: [0, 1, 0] };

			await adapter.upsert(first);
			await adapter.upsert(second);
			await waitForEntry(second.id);

			await adapter.remove(second.id);

			await waitFor(async () => (await adapter.getById(second.id)) === undefined);

			await expect(adapter.getById(first.id)).resolves.toEqual(first);
		});
	});

	async function waitForEntry(
		id: string,
		predicate: (entry: CacheEntry) => boolean = () => true,
	): Promise<CacheEntry> {
		return waitFor(async () => {
			const stored = await adapter.getById(id);

			return stored !== undefined && predicate(stored) ? stored : undefined;
		});
	}
});

/**
 * Polls `check` until it yields a truthy value, giving Pinecone time to make a
 * write visible.
 */
async function waitFor<TResult>(
	check: () => Promise<TResult | undefined | false>,
): Promise<TResult> {
	const deadline = Date.now() + CONSISTENCY_TIMEOUT_MS;

	for (;;) {
		const result = await check();

		if (result) {
			return result as TResult;
		}

		if (Date.now() >= deadline) {
			throw new Error(`Pinecone did not converge within ${CONSISTENCY_TIMEOUT_MS}ms.`);
		}

		await new Promise((resolve) => setTimeout(resolve, CONSISTENCY_POLL_INTERVAL_MS));
	}
}
