// Request-coalescing embedding adapter wrapper.
//
// Buffers individual `embed` calls and flushes them to the wrapped adapter's
// `embedBatch` as a single request. A batch is flushed when either the buffer
// reaches `maxBatchSize` or `maxWaitMs` elapses after the first buffered item,
// whichever comes first.
//
// This wrapper is provider-agnostic: it depends only on the EmbeddingAdapter
// contract and works with any conforming adapter (OpenAI, Cohere, a local
// model, etc.). Provider-specific concerns (HTTP, auth, request-size limits)
// live in the wrapped adapter, not here.
//
// Caveat: it relies on the EmbeddingAdapter contract that `embedBatch` returns
// vectors positionally aligned to its inputs (vector i corresponds to input i).
// We resolve each buffered call by that index, so a custom adapter MUST honor
// this ordering — even if its provider returns results out of order, the
// adapter is responsible for realigning them before returning.
import type { EmbeddingAdapter } from "./types";

export interface BatchingEmbeddingAdapterOptions {
	/** Flush once this many inputs are buffered. */
	maxBatchSize: number;
	/** Flush at most this many milliseconds after the first buffered input. */
	maxWaitMs: number;
}

interface PendingRequest {
	input: string;
	resolve: (vector: Array<number>) => void;
	reject: (error: unknown) => void;
}

export function createBatchingEmbeddingAdapter(
	inner: EmbeddingAdapter,
	options: BatchingEmbeddingAdapterOptions,
): EmbeddingAdapter {
	const { maxBatchSize, maxWaitMs } = options;

	if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
		throw new Error("createBatchingEmbeddingAdapter requires an integer maxBatchSize >= 1.");
	}

	if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
		throw new Error("createBatchingEmbeddingAdapter requires a finite maxWaitMs >= 0.");
	}

	let queue: Array<PendingRequest> = [];
	let timer: ReturnType<typeof setTimeout> | undefined;

	const flush = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}

		if (queue.length === 0) {
			return;
		}

		// Snapshot and reset so new calls accumulate into the next batch.
		const batch = queue;
		queue = [];

		inner
			.embedBatch(batch.map((item) => item.input))
			.then((vectors) => {
				if (vectors.length !== batch.length) {
					const error = new Error(
						"Batched embedding response size did not match the number of queued inputs.",
					);
					batch.forEach((item) => item.reject(error));
					return;
				}

				batch.forEach((item, index) => item.resolve(vectors[index]));
			})
			.catch((error: unknown) => {
				// A failed batch rejects every input it contained.
				batch.forEach((item) => item.reject(error));
			});
	};

	return {
		embed(input: string): Promise<Array<number>> {
			return new Promise<Array<number>>((resolve, reject) => {
				queue.push({ input, resolve, reject });

				if (queue.length >= maxBatchSize) {
					flush();
					return;
				}

				if (timer === undefined) {
					timer = setTimeout(flush, maxWaitMs);
					// Don't keep the process alive solely for a pending flush.
					timer.unref?.();
				}
			});
		},

		embedBatch(inputs: ReadonlyArray<string>): Promise<Array<Array<number>>> {
			// Already an explicit batch — pass straight through without buffering.
			return inner.embedBatch(inputs);
		},
	};
}
