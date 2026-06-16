import { createOpenAIEmbeddingAdapter } from "../../src/adapters/embeddings/openai";

// These tests stub global.fetch — no real OpenAI requests are made.
describe("createOpenAIEmbeddingAdapter", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		jest.restoreAllMocks();
	});

	const okResponse = (
		data: Array<{ embedding: number[]; index: number }>,
	): { ok: true; status: number; statusText: string; json: () => Promise<unknown> } => ({
		ok: true,
		status: 200,
		statusText: "OK",
		json: async () => ({
			object: "list",
			model: "text-embedding-3-small",
			data: data.map((item) => ({ ...item, object: "embedding" })),
			usage: { prompt_tokens: 1, total_tokens: 1 },
		}),
	});

	it("throws when constructed without an apiKey", () => {
		expect(() => createOpenAIEmbeddingAdapter({ apiKey: "  " })).toThrow(/apiKey/);
	});

	it("embeds a single input and returns its vector", async () => {
		const fetchMock = jest.fn().mockResolvedValue(okResponse([{ embedding: [0.1, 0.2], index: 0 }]));
		global.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createOpenAIEmbeddingAdapter({ apiKey: "sk-test" });
		await expect(adapter.embed("hello")).resolves.toEqual([0.1, 0.2]);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/embeddings");
		expect(JSON.parse((init as { body: string }).body)).toEqual({
			model: "text-embedding-3-small",
			input: ["hello"],
			encoding_format: "float",
		});
	});

	it("rejects an empty single input without calling fetch", async () => {
		const fetchMock = jest.fn();
		global.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createOpenAIEmbeddingAdapter({ apiKey: "sk-test" });
		await expect(adapter.embed("")).rejects.toThrow(/non-empty/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("realigns batched vectors by their response index", async () => {
		// Return the vectors out of order to prove we sort by `index`.
		const fetchMock = jest.fn().mockResolvedValue(
			okResponse([
				{ embedding: [2], index: 2 },
				{ embedding: [0], index: 0 },
				{ embedding: [1], index: 1 },
			]),
		);
		global.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createOpenAIEmbeddingAdapter({ apiKey: "sk-test" });
		await expect(adapter.embedBatch(["a", "b", "c"])).resolves.toEqual([[0], [1], [2]]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("splits batches larger than 2048 inputs into chunked requests", async () => {
		const fetchMock = jest.fn().mockImplementation(async (_url, init) => {
			const body = JSON.parse((init as { body: string }).body) as { input: string[] };
			return okResponse(body.input.map((_value, index) => ({ embedding: [index], index })));
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createOpenAIEmbeddingAdapter({ apiKey: "sk-test" });
		const inputs = Array.from({ length: 2049 }, (_value, index) => `q${index}`);

		const vectors = await adapter.embedBatch(inputs);

		expect(vectors).toHaveLength(2049);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		// First request gets the 2048-input limit, the second gets the remainder.
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toHaveLength(2048);
		expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toHaveLength(1);
	});

	it("returns an empty array for an empty batch without calling fetch", async () => {
		const fetchMock = jest.fn();
		global.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createOpenAIEmbeddingAdapter({ apiKey: "sk-test" });
		await expect(adapter.embedBatch([])).resolves.toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("surfaces the OpenAI error message on a non-2xx response", async () => {
		const fetchMock = jest.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			json: async () => ({ error: { message: "Invalid API key" } }),
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createOpenAIEmbeddingAdapter({ apiKey: "sk-test" });
		await expect(adapter.embed("hello")).rejects.toThrow(
			/401 Unauthorized.*Invalid API key/,
		);
	});

	it("honors a custom baseUrl and model and strips a trailing slash", async () => {
		const fetchMock = jest.fn().mockResolvedValue(okResponse([{ embedding: [1], index: 0 }]));
		global.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createOpenAIEmbeddingAdapter({
			apiKey: "sk-test",
			model: "text-embedding-3-large",
			baseUrl: "https://proxy.example.com/v1/",
		});
		await adapter.embed("hello");

		expect(fetchMock.mock.calls[0][0]).toBe("https://proxy.example.com/v1/embeddings");
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("text-embedding-3-large");
	});
});
