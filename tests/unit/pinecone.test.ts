import { createPineconeDatabaseAdapter } from "../../src/adapters/db/providers/pinecone";
import type { CacheEntry } from "../../src/types";

// These tests stub global.fetch — no real Pinecone requests are made.
describe("createPineconeDatabaseAdapter", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		jest.restoreAllMocks();
	});

	const HOST = "test-index-abc123.svc.aped-1234.pinecone.io";

	const jsonResponse = (
		body: unknown,
		status = 200,
	): { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> } => ({
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Error",
		json: async () => body,
	});

	const describeResponse = (
		overrides: { metric?: string; ready?: boolean } = {},
	): ReturnType<typeof jsonResponse> =>
		jsonResponse({
			name: "test-index",
			host: HOST,
			dimension: 3,
			metric: overrides.metric ?? "cosine",
			status: { ready: overrides.ready ?? true, state: "Ready" },
		});

	// Routes each stubbed request by URL so a single mock can serve the
	// control-plane lookup plus whatever data-plane call the test makes.
	const routedFetch = (
		routes: Record<string, unknown>,
	): jest.Mock<Promise<unknown>, [string, RequestInit?]> =>
		jest.fn(async (url: string) => {
			const match = Object.keys(routes).find((path) => url.includes(path));

			if (match === undefined) {
				throw new Error(`Unexpected request: ${url}`);
			}

			const route = routes[match];

			return typeof route === "function" ? route(url) : route;
		}) as unknown as jest.Mock<Promise<unknown>, [string, RequestInit?]>;

	const createAdapter = (
		options: Partial<Parameters<typeof createPineconeDatabaseAdapter>[0]> = {},
	): ReturnType<typeof createPineconeDatabaseAdapter> =>
		createPineconeDatabaseAdapter({
			apiKey: "pc-test",
			indexName: "test-index",
			...options,
		});

	const entry: CacheEntry = {
		id: "entry-1",
		query: "hello",
		embedding: [1, 0, 0],
		value: { answer: 42 },
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-02T00:00:00.000Z",
		hits: 3,
		metadata: { source: "test" },
	};

	// The shape entryToRecord writes for `entry` above.
	const storedRecord = {
		id: "entry-1",
		values: [1, 0, 0],
		metadata: {
			query: "hello",
			value: JSON.stringify({ answer: 42 }),
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-02T00:00:00.000Z",
			hits: 3,
			metadata: JSON.stringify({ source: "test" }),
		},
	};

	it("throws when constructed without an apiKey", () => {
		expect(() => createAdapter({ apiKey: "  " })).toThrow(/apiKey/);
	});

	it("throws when constructed without an indexName", () => {
		expect(() => createAdapter({ indexName: " " })).toThrow(/indexName/);
	});

	it("resolves the data-plane host from the control plane once and reuses it", async () => {
		const fetchMock = routedFetch({
			"/indexes/test-index": describeResponse(),
			"/vectors/upsert": jsonResponse({ upsertedCount: 1 }),
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createAdapter();

		await adapter.upsert(entry);
		await adapter.upsert(entry);

		const describeCalls = fetchMock.mock.calls.filter(([url]) =>
			url.startsWith("https://api.pinecone.io"),
		);

		expect(describeCalls).toHaveLength(1);
		expect(fetchMock.mock.calls[1][0]).toBe(`https://${HOST}/vectors/upsert`);
	});

	it("skips the control-plane lookup when a host is supplied", async () => {
		const fetchMock = routedFetch({ "/vectors/upsert": jsonResponse({ upsertedCount: 1 }) });
		global.fetch = fetchMock as unknown as typeof fetch;

		await createAdapter({ host: `https://${HOST}/` }).upsert(entry);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(`https://${HOST}/vectors/upsert`);
	});

	it("rejects an index that does not use the cosine metric", async () => {
		global.fetch = routedFetch({
			"/indexes/test-index": describeResponse({ metric: "euclidean" }),
		}) as unknown as typeof fetch;

		await expect(createAdapter().getById("entry-1")).rejects.toThrow(/cosine/);
	});

	it("points at initialize() when the index does not exist", async () => {
		global.fetch = routedFetch({
			"/indexes/test-index": jsonResponse({ message: "not found" }, 404),
		}) as unknown as typeof fetch;

		await expect(createAdapter().getById("entry-1")).rejects.toThrow(/initialize/);
	});

	it("serializes value and metadata as JSON on upsert", async () => {
		const fetchMock = routedFetch({
			"/vectors/upsert": jsonResponse({ upsertedCount: 1 }),
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		await createAdapter({ host: HOST, namespace: "cachelab" }).upsert(entry);

		const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);

		expect(body).toEqual({ vectors: [storedRecord], namespace: "cachelab" });
	});

	it("omits the metadata field entirely for entries without metadata", async () => {
		const fetchMock = routedFetch({ "/vectors/upsert": jsonResponse({ upsertedCount: 1 }) });
		global.fetch = fetchMock as unknown as typeof fetch;

		const { metadata: _metadata, ...entryWithoutMetadata } = entry;

		await createAdapter({ host: HOST }).upsert(entryWithoutMetadata);

		const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);

		expect(body.vectors[0].metadata).not.toHaveProperty("metadata");
		expect(body).not.toHaveProperty("namespace");
	});

	it("round-trips an entry through getById", async () => {
		global.fetch = routedFetch({
			"/vectors/fetch": jsonResponse({ vectors: { "entry-1": storedRecord } }),
		}) as unknown as typeof fetch;

		await expect(createAdapter({ host: HOST }).getById("entry-1")).resolves.toEqual(entry);
	});

	it("returns undefined for an id the index does not hold", async () => {
		global.fetch = routedFetch({
			"/vectors/fetch": jsonResponse({ vectors: {} }),
		}) as unknown as typeof fetch;

		await expect(createAdapter({ host: HOST }).getById("missing")).resolves.toBeUndefined();
	});

	it("treats the match score as the cosine similarity and reports a hit", async () => {
		global.fetch = routedFetch({
			"/query": jsonResponse({ matches: [{ ...storedRecord, score: 0.93 }] }),
		}) as unknown as typeof fetch;

		await expect(createAdapter({ host: HOST }).findBestMatch([1, 0, 0], 0.8)).resolves.toEqual({
			hit: true,
			similarity: 0.93,
			threshold: 0.8,
			entry,
			reason: "threshold-met",
		});
	});

	it("reports threshold-not-met without an entry when the best match is too far", async () => {
		global.fetch = routedFetch({
			"/query": jsonResponse({ matches: [{ ...storedRecord, score: 0.42 }] }),
		}) as unknown as typeof fetch;

		await expect(createAdapter({ host: HOST }).findBestMatch([1, 0, 0], 0.8)).resolves.toEqual({
			hit: false,
			similarity: 0.42,
			threshold: 0.8,
			entry: undefined,
			reason: "threshold-not-met",
		});
	});

	it("reports no-candidate for an empty index", async () => {
		global.fetch = routedFetch({
			"/query": jsonResponse({ matches: [] }),
		}) as unknown as typeof fetch;

		await expect(createAdapter({ host: HOST }).findBestMatch([1, 0, 0], 0.8)).resolves.toEqual({
			hit: false,
			similarity: 0,
			threshold: 0.8,
			entry: undefined,
			reason: "no-candidate",
		});
	});

	it("pages through every listed id in getAll", async () => {
		const second = { ...storedRecord, id: "entry-2" };

		const fetchMock = routedFetch({
			"/vectors/list": (url: string) =>
				url.includes("paginationToken=page-2")
					? jsonResponse({ vectors: [{ id: "entry-2" }] })
					: jsonResponse({
							vectors: [{ id: "entry-1" }],
							pagination: { next: "page-2" },
						}),
			"/vectors/fetch": (url: string) =>
				url.includes("entry-2")
					? jsonResponse({ vectors: { "entry-2": second } })
					: jsonResponse({ vectors: { "entry-1": storedRecord } }),
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const entries = await createAdapter({ host: HOST }).getAll();

		expect(entries.map((stored) => stored.id)).toEqual(["entry-1", "entry-2"]);
		expect(fetchMock.mock.calls.filter(([url]) => url.includes("/vectors/list"))).toHaveLength(
			2,
		);
	});

	it("deletes a single id on remove and everything on clear", async () => {
		const fetchMock = routedFetch({ "/vectors/delete": jsonResponse({}) });
		global.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createAdapter({ host: HOST, namespace: "cachelab" });

		await adapter.remove("entry-1");
		await adapter.clear();

		expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({
			ids: ["entry-1"],
			namespace: "cachelab",
		});
		expect(JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)).toEqual({
			deleteAll: true,
			namespace: "cachelab",
		});
	});

	it("treats clear() on a namespace that was never written to as a no-op", async () => {
		global.fetch = routedFetch({
			"/vectors/delete": jsonResponse({ message: "Namespace not found" }, 404),
		}) as unknown as typeof fetch;

		await expect(
			createAdapter({ host: HOST, namespace: "fresh" }).clear(),
		).resolves.toBeUndefined();
	});

	it("surfaces the Pinecone error message on a non-2xx response", async () => {
		global.fetch = routedFetch({
			"/query": jsonResponse({ message: "Vector dimension 2 does not match the index" }, 400),
		}) as unknown as typeof fetch;

		await expect(createAdapter({ host: HOST }).findBestMatch([1, 0], 0.8)).rejects.toThrow(
			/query request failed \(400.*does not match the index/,
		);
	});

	it("creates a serverless cosine index in initialize when it is missing", async () => {
		let described = 0;

		const fetchMock = routedFetch({
			"/indexes/test-index": () => {
				described += 1;
				// Missing on the first look, then still provisioning, then ready.
				if (described === 1) {
					return jsonResponse({ message: "not found" }, 404);
				}

				return describeResponse({ ready: described > 2 });
			},
			"/indexes": jsonResponse({ name: "test-index" }, 201),
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		jest.spyOn(global, "setTimeout").mockImplementation(((callback: () => void) => {
			callback();
			return 0;
		}) as unknown as typeof setTimeout);

		await createAdapter({ vectorDimensions: 3, region: "us-west-2" }).initialize?.();

		const createCall = fetchMock.mock.calls.find(
			([url, init]) =>
				url.endsWith("/indexes") && (init as { method: string }).method === "POST",
		);

		expect(JSON.parse((createCall?.[1] as { body: string }).body)).toEqual({
			name: "test-index",
			dimension: 3,
			metric: "cosine",
			spec: { serverless: { cloud: "aws", region: "us-west-2" } },
		});
		// Polled until status.ready flipped to true.
		expect(described).toBe(3);
	});

	it("requires vectorDimensions to create a missing index", async () => {
		global.fetch = routedFetch({
			"/indexes/test-index": jsonResponse({ message: "not found" }, 404),
		}) as unknown as typeof fetch;

		await expect(createAdapter().initialize?.()).rejects.toThrow(/vectorDimensions/);
	});

	it("reuses an existing index in initialize without creating one", async () => {
		const fetchMock = routedFetch({ "/indexes/test-index": describeResponse() });
		global.fetch = fetchMock as unknown as typeof fetch;

		await createAdapter({ vectorDimensions: 3 }).initialize?.();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET");
	});
});
