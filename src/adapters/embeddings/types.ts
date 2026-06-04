// Embedding adapter contract.
export interface EmbeddingAdapter {
	embed(input: string): Promise<Array<number>>;
}