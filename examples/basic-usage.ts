// Runnable example placeholder for the README usage snippet.
import {
	CacheLabClient,
	createInMemoryDatabaseAdapter,
	type EmbeddingAdapter,
	type LLMAdapter,
} from "../src";

const embeddingAdapter: EmbeddingAdapter = {
	async embed(input: string): Promise<Array<number>> {
		void input;
		throw new Error("Example embedding adapter is not implemented yet.");
	},
};

const llmAdapter: LLMAdapter<string> = {
	async generate(prompt: string): Promise<string> {
		void prompt;
		throw new Error("Example LLM adapter is not implemented yet.");
	},
};

const client = new CacheLabClient({
	dbAdapter: createInMemoryDatabaseAdapter(),
	embeddingAdapter,
	llmAdapter,
});

async function main(): Promise<void> {
	void client;
	throw new Error("Example main is not implemented yet.");
}

void main();
