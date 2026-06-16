import { createBatchingEmbeddingAdapter } from "../../src/adapters/embeddings/batching";

describe("createBatchingEmbeddingAdapter", () => {
	const makeInner = (
		embedBatch: jest.Mock = jest.fn().mockResolvedValue([]),
	): { embed: jest.Mock; embedBatch: jest.Mock } => ({
		embed: jest.fn(),
		embedBatch,
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("flushes immediately once maxBatchSize is reached", async () => {
		const inner = makeInner(
			jest.fn().mockResolvedValue([
				[1, 0],
				[0, 1],
			]),
		);
		const adapter = createBatchingEmbeddingAdapter(inner, {
			maxBatchSize: 2,
			maxWaitMs: 1000,
		});

		const first = adapter.embed("a");
		expect(inner.embedBatch).not.toHaveBeenCalled();

		const second = adapter.embed("b");

		await expect(first).resolves.toEqual([1, 0]);
		await expect(second).resolves.toEqual([0, 1]);
		expect(inner.embedBatch).toHaveBeenCalledTimes(1);
		expect(inner.embedBatch).toHaveBeenCalledWith(["a", "b"]);
	});

	it("flushes a partial batch after maxWaitMs", async () => {
		jest.useFakeTimers();
		const inner = makeInner(
			jest.fn().mockResolvedValue([
				[1, 0],
				[0, 1],
			]),
		);
		const adapter = createBatchingEmbeddingAdapter(inner, {
			maxBatchSize: 10,
			maxWaitMs: 50,
		});

		const first = adapter.embed("a");
		const second = adapter.embed("b");
		expect(inner.embedBatch).not.toHaveBeenCalled();

		jest.advanceTimersByTime(50);

		await expect(first).resolves.toEqual([1, 0]);
		await expect(second).resolves.toEqual([0, 1]);
		expect(inner.embedBatch).toHaveBeenCalledTimes(1);
		expect(inner.embedBatch).toHaveBeenCalledWith(["a", "b"]);
	});

	it("rejects every queued input when the batch fails", async () => {
		const error = new Error("provider batching failed");
		const inner = makeInner(jest.fn().mockRejectedValue(error));
		const adapter = createBatchingEmbeddingAdapter(inner, {
			maxBatchSize: 2,
			maxWaitMs: 1000,
		});

		const first = adapter.embed("a");
		const second = adapter.embed("b");

		await expect(first).rejects.toThrow("provider batching failed");
		await expect(second).rejects.toThrow("provider batching failed");
	});

	it("rejects when the response size does not match the batch size", async () => {
		// 2 queries but only 1 embedding returned.
		const inner = makeInner(jest.fn().mockResolvedValue([[1, 0]]));
		const adapter = createBatchingEmbeddingAdapter(inner, {
			maxBatchSize: 2,
			maxWaitMs: 1000,
		});

		const first = adapter.embed("a");
		const second = adapter.embed("b");

		await expect(first).rejects.toThrow(/did not match/);
		await expect(second).rejects.toThrow(/did not match/);
	});

	it("passes embedBatch straight through to the inner adapter", async () => {
		const inner = makeInner(jest.fn().mockResolvedValue([[9, 9]]));
		const adapter = createBatchingEmbeddingAdapter(inner, {
			maxBatchSize: 2,
			maxWaitMs: 10,
		});

		await expect(adapter.embedBatch(["x"])).resolves.toEqual([[9, 9]]);
		expect(inner.embedBatch).toHaveBeenCalledWith(["x"]);
	});

	it("starts a fresh batch after a flush", async () => {
		const inner = makeInner();
		inner.embedBatch
			.mockResolvedValueOnce([[1, 0]])
			.mockResolvedValueOnce([[0, 1]]);
		const adapter = createBatchingEmbeddingAdapter(inner, {
			maxBatchSize: 1,
			maxWaitMs: 1000,
		});

		await expect(adapter.embed("a")).resolves.toEqual([1, 0]);
		await expect(adapter.embed("b")).resolves.toEqual([0, 1]);
		expect(inner.embedBatch).toHaveBeenNthCalledWith(1, ["a"]);
		expect(inner.embedBatch).toHaveBeenNthCalledWith(2, ["b"]);
	});

	it("validates its options", () => {
		const inner = makeInner();

		expect(() => createBatchingEmbeddingAdapter(inner, { maxBatchSize: 0, maxWaitMs: 10 })).toThrow();
		expect(() =>
			createBatchingEmbeddingAdapter(inner, { maxBatchSize: 1.5, maxWaitMs: 10 }),
		).toThrow();
		expect(() => createBatchingEmbeddingAdapter(inner, { maxBatchSize: 2, maxWaitMs: -1 })).toThrow();
	});
});
