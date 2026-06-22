import { Pool } from "pg";
import "dotenv/config";

import { createPostgresDatabaseAdapter } from "../../src/adapters/db/providers/postgres";
import type { CacheEntry } from "../../src/types";

describe("PostgresDatabaseAdapter", () => {
	let pool: Pool;
	let adapter: ReturnType<typeof createPostgresDatabaseAdapter>;

	beforeEach(async () => {
		const connectionString = process.env.TEST_POSTGRES_CONNECTION_STRING;

		if (!connectionString) {
			throw new Error("TEST_POSTGRES_CONNECTION_STRING must be set for integration tests");
		}

		pool = new Pool({ connectionString });

		adapter = createPostgresDatabaseAdapter({
			connectionString,
		});

		await adapter.initialize?.();
		await adapter.clear();
	});

	afterEach(async () => {
		await adapter?.close?.();
		await pool?.end();
	});

	describe("database initialization", () => {
		it("creates the cache_entries table when it does not exist", async () => {
			const result = await pool.query(`
				SELECT EXISTS (
					SELECT 1
					FROM information_schema.tables
					WHERE table_name = 'cache_entries'
				) AS exists
			`);

			expect(result.rows[0].exists).toBe(true);
		});
	});

	describe("entry persistence", () => {
		it("updates an existing entry without modifying createdAt", async () => {
			const original: CacheEntry = {
				id: "entry-1",
				query: "hello",
				embedding: [1, 0, 0],
				value: { version: 1 },
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
				hits: 0,
				metadata: {
					source: "original",
				},
			};

			await adapter.upsert(original);

			const updated: CacheEntry = {
				...original,
				query: "updated query",
				embedding: [0, 1, 0],
				value: { version: 2 },
				updatedAt: "2025-01-02T00:00:00.000Z",
				metadata: {
					source: "updated",
				},
			};

			await adapter.upsert(updated);

			const stored = await adapter.getById(original.id);

			expect(stored).toBeDefined();

			expect(stored?.createdAt).toBe(original.createdAt);
			expect(stored?.updatedAt).toBe(updated.updatedAt);

			expect(stored?.query).toBe(updated.query);
			expect(stored?.embedding).toEqual(updated.embedding);
			expect(stored?.value).toEqual(updated.value);
			expect(stored?.metadata).toEqual(updated.metadata);
		});

		it("supports entries without metadata", async () => {
			const entry: CacheEntry = {
				id: "entry-without-metadata",
				query: "hello",
				embedding: [1, 0, 0],
				value: {
					answer: 42,
				},
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
				hits: 0,
			};

			await adapter.upsert(entry);

			const stored = await adapter.getById(entry.id);

			expect(stored).toEqual(entry);
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
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-02T00:00:00.000Z",
				hits: 7,
				metadata: {
					tags: ["a", "b"],
					nested: {
						x: 1,
					},
				},
			};

			await adapter.upsert(entry);

			const entries = await adapter.getAll();

			expect(entries).toHaveLength(1);
			expect(entries[0]).toEqual(entry);
		});
	});

	describe("additional integration coverage", () => {
		it("persists entries across adapter instances", async () => {
			const connectionString = process.env.TEST_POSTGRES_CONNECTION_STRING!;

			const entry: CacheEntry = {
				id: "persistent-entry",
				query: "persist me",
				embedding: [1, 0, 0],
				value: {
					test: true,
				},
				createdAt: "2025-01-01T00:00:00.000Z",
				updatedAt: "2025-01-01T00:00:00.000Z",
				hits: 0,
			};

			await adapter.upsert(entry);

			const secondAdapter = createPostgresDatabaseAdapter({
				connectionString,
			});

			try {
				const stored = await secondAdapter.getById(entry.id);

				expect(stored).toEqual(entry);

				const updatedEntry: CacheEntry = {
					...entry,
					query: "persist me, updated",
					embedding: [0, 1, 0],
					value: { test: false },
					updatedAt: "2025-02-01T00:00:00.000Z",
				};

				await secondAdapter.upsert(updatedEntry);

				const storedAfterUpdate = await adapter.getById(entry.id);

				expect(storedAfterUpdate).toEqual(updatedEntry);
				expect(storedAfterUpdate?.createdAt).toBe(entry.createdAt);
			} finally {
				await secondAdapter.close?.();
			}
		});
	});
});
