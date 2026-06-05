import { CacheLabClient } from "../../src/client";
import type { CacheEntry } from "../../src/types";

describe("CacheLabClient.invoke", () => {
	const createClient = (entries: Array<CacheEntry<string>> = []) => {
		const dbAdapter = {
			getAll: jest.fn().mockResolvedValue(entries),
			getById: jest.fn(),
			upsert: jest.fn().mockResolvedValue(undefined),
			remove: jest.fn(),
			clear: jest.fn(),
		};

		const embeddingAdapter = {
			embed: jest.fn().mockResolvedValue([1, 0]),
		};

		return {
			client: new CacheLabClient({ dbAdapter, embeddingAdapter }),
			dbAdapter,
			embeddingAdapter,
		};
	};

	const makeEntry = (overrides: Partial<CacheEntry<string>> = {}): CacheEntry<string> => ({
		id: overrides.id ?? "entry-x",
		query: overrides.query ?? "q",
		embedding: overrides.embedding ?? [1, 0],
		value: overrides.value ?? "v",
		createdAt: overrides.createdAt ?? "2026-06-05T00:00:00.000Z",
		updatedAt: overrides.updatedAt ?? "2026-06-05T00:00:00.000Z",
		hits: overrides.hits ?? 0,
		metadata: overrides.metadata,
	});

	describe("singular cache hit returns the cached value", () => {
		it("perfect query match", async () => {
			const cachedEntry = makeEntry({
				id: "entry-1",
				query: "cached query",
				embedding: [1, 0],
				value: "cached value",
				hits: 1,
			});

			const { client, embeddingAdapter } = createClient([cachedEntry]);
			const compute = jest.fn().mockResolvedValue("origin value");

			const result = await client.invoke({
				query: "cached query",
				compute,
				threshold: 0.95,
			});

			expect(embeddingAdapter.embed).toHaveBeenCalledWith("cached query");
			expect(compute).not.toHaveBeenCalled();
			expect(result).toEqual({
				data: "cached value",
				source: "cache",
				decision: expect.objectContaining({
					hit: true,
					threshold: 0.95,
					entry: cachedEntry,
					reason: "threshold-met",
				}),
				cachedAt: cachedEntry.createdAt,
			});
		});

		it("match similarity = threshold", async () => {
			const cachedEntry = makeEntry({
				id: "entry-4",
				query: "what is the tuition fee",
				embedding: [0.9, Math.sqrt(1 - 0.9 * 0.9)],
				value: "tuition is $5000",
				hits: 1,
			});

			const { client, embeddingAdapter } = createClient([cachedEntry]);
			embeddingAdapter.embed.mockResolvedValue([0.9, Math.sqrt(1 - 0.9 * 0.9)]);
			const compute = jest.fn().mockResolvedValue("origin value");

			const result = await client.invoke({
				query: "how much is tuition",
				compute,
				threshold: 0.9,
			});

			expect(compute).not.toHaveBeenCalled();
			expect(result.source).toBe("cache");
			expect(result.decision.hit).toBe(true);
			expect(result.decision.similarity).toBeCloseTo(0.9);
		});

		it("uses the default threshold when one is not provided", async () => {
			const cachedEntry = makeEntry({
				id: "entry-3",
				query: "default threshold query",
				embedding: [1, 0],
				value: "default hit",
				hits: 1,
			});

			const { client } = createClient([cachedEntry]);
			const compute = jest.fn().mockResolvedValue("unused origin value");

			const result = await client.invoke({
				query: "default threshold query",
				compute,
			});

			expect(result.decision.threshold).toBe(0.8);
			expect(result.source).toBe("cache");
			expect(result.data).toBe("default hit");
			expect(compute).not.toHaveBeenCalled();
		});

		it("returns only correct answer from multiple candidates", async () => {
			const a = makeEntry({ id: "a", query: "query a", embedding: [1, 0], value: "cached a" });
			const b = makeEntry({ id: "b", query: "query b", embedding: [0.6, 0.8], value: "cached b" });

			const { client, embeddingAdapter } = createClient([a, b]);
			embeddingAdapter.embed.mockResolvedValue([0.7, 0.7]);
			const compute = jest.fn().mockResolvedValue("origin value");

			const result = await client.invoke({ query: "closest to b", compute, threshold: 0.5 });

			expect(compute).not.toHaveBeenCalled();
			expect(result.source).toBe("cache");
			expect(result.data).toBe("cached b");
			expect(result.decision.entry?.id).toBe("b");
		});
	});
    
	describe("cache miss invoke compute function", () => {
		it("no entry in cache", async () => {
			const { client } = createClient([]);
			const compute = jest.fn().mockResolvedValue("fresh value");

			const result = await client.invoke({
				query: "no cache here",
				compute,
				threshold: 0.9,
			});

			expect(compute).toHaveBeenCalledTimes(1);
			expect(result.source).toBe("origin");
			expect(result.decision.hit).toBe(false);
			expect(result.decision.reason).toBe("no-candidate");
		});

		it("no entry reaches the threshold", async () => {
			const cachedEntry = makeEntry({
				id: "entry-2",
				query: "unrelated query",
				embedding: [0, 1],
				value: "stale value",
				hits: 1,
			});

			const { client } = createClient([cachedEntry]);
			const compute = jest.fn().mockResolvedValue("fresh value");

			const result = await client.invoke({
				query: "new query",
				compute,
				threshold: 0.95,
			});

			expect(compute).toHaveBeenCalledTimes(1);
			expect(result).toEqual({
				data: "fresh value",
				source: "origin",
				decision: {
					hit: false,
					similarity: 0,
					threshold: 0.95,
					entry: undefined,
					reason: "threshold-not-met",
				},
			});
		});

		it("similarity just below the threshold", async () => {
			const cachedEntry = makeEntry({
				id: "entry-5",
				query: "what is the tuition fee",
				embedding: [0.9, Math.sqrt(1 - 0.9 * 0.9)],
				value: "tuition is $5000",
				hits: 1,
			});

			const { client, embeddingAdapter } = createClient([cachedEntry]);
			embeddingAdapter.embed.mockResolvedValue([0.89, Math.sqrt(1 - 0.89 * 0.89)]);
			const compute = jest.fn().mockResolvedValue("fresh value");

			const result = await client.invoke({
				query: "how much does tuition cost",
				compute,
				threshold: 0.9,
			});

			expect(compute).toHaveBeenCalledTimes(1);
			expect(result.source).toBe("origin");
			expect(result.decision.hit).toBe(false);
			expect(result.decision.similarity).toBeCloseTo(0.89);
		});
	});

	describe("post-invoke side effects", () => {
		it("stores the compute result after a miss", async () => {
			const { client, dbAdapter, embeddingAdapter } = createClient([]);
			embeddingAdapter.embed.mockResolvedValue([0, 1]);
			const compute = jest.fn().mockResolvedValue("stored value");

			const result = await client.invoke({
				query: "store this",
				compute,
				threshold: 0.9,
			});

			expect(compute).toHaveBeenCalledTimes(1);
			expect(dbAdapter.upsert).toHaveBeenCalled();
			const upsertArg = (dbAdapter.upsert as jest.Mock).mock.calls[0][0];
			expect(upsertArg).toEqual(expect.objectContaining({
				query: "store this",
				value: "stored value",
			}));
			expect(result.data).toBe("stored value");
		});

		it("increments hit count after a cache hit", async () => {
			const cachedEntry = makeEntry({
				id: "entry-hit",
				query: "hit me",
				embedding: [1, 0],
				value: "cached",
				hits: 2,
			});

			const { client, dbAdapter } = createClient([cachedEntry]);
			const compute = jest.fn().mockResolvedValue("unused");

			const result = await client.invoke({
				query: "hit me",
				compute,
				threshold: 0.8,
			});

			expect(result.source).toBe("cache");
			expect(dbAdapter.upsert).toHaveBeenCalled();
			const upsertArg = (dbAdapter.upsert as jest.Mock).mock.calls[0][0];
			expect(upsertArg.hits).toBe(cachedEntry.hits + 1);
		});
	});

	describe("multiple cache hit entries", () => {
		it("returns the highest similarity match above threshold", async () => {
			const a = makeEntry({ id: "a", embedding: [1, 0], value: "one" });
			const b = makeEntry({ id: "b", embedding: [0.6, 0.8], value: "two" });

			const { client, embeddingAdapter } = createClient([a, b]);
			// choose a probe vector closer to b: dot with a = 0.7, with b = 0.98
			embeddingAdapter.embed.mockResolvedValue([0.7, 0.7]);
			const compute = jest.fn();

			const result = await client.invoke({ query: "closest to b", compute, threshold: 0.5 });

			expect(compute).not.toHaveBeenCalled();
			expect(result.source).toBe("cache");
			expect(result.data).toBe("two");
			expect(result.decision.entry?.id).toBe("b");
		});
	});

});


