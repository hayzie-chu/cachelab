// Embedding adapter contract.
export interface EmbeddingAdapter {
	/** Embed a single input string into a vector. */
	embed(input: string): Promise<Array<number>>;

	/**
	 * Embed many inputs in a single call, returning one vector per input in the
	 * same order as `inputs`. Implementations should send the inputs to the
	 * provider together to amortize per-request overhead.
	 */
	embedBatch(inputs: ReadonlyArray<string>): Promise<Array<Array<number>>>;
}
