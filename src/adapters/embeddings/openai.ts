// OpenAI embeddings adapter.
import type { EmbeddingAdapter } from "./types";

export interface OpenAIEmbeddingAdapterOptions {
	apiKey: string;
	model?: string;
	baseUrl?: string;
}

interface OpenAIEmbeddingResponse {
	data: Array<{
		embedding: number[];
		index: number;
		object: string;
	}>;
	model: string;
	object: string;
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

interface OpenAIErrorResponse {
	error?: {
		message?: string;
		type?: string;
		code?: string | null;
	};
}

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
// OpenAI rejects embedding requests with more than 2048 inputs per call, so
// embedBatch transparently splits larger batches into chunks of this size.
const MAX_INPUTS_PER_REQUEST = 2048;

export function createOpenAIEmbeddingAdapter(
	options: OpenAIEmbeddingAdapterOptions,
): EmbeddingAdapter {
	const apiKey = options.apiKey?.trim();

	if (!apiKey) {
		throw new Error("createOpenAIEmbeddingAdapter requires a non-empty apiKey.");
	}

	const model = options.model ?? DEFAULT_MODEL;
	// Strip a trailing slash so we can join the path cleanly.
	const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

	// Sends one request for up to MAX_INPUTS_PER_REQUEST inputs and returns the
	// vectors aligned to the input order.
	async function requestEmbeddings(inputs: ReadonlyArray<string>): Promise<Array<Array<number>>> {
		const response = await fetch(`${baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				input: inputs,
				encoding_format: "float",
			}),
		});

		if (!response.ok) {
			throw new Error(await formatErrorMessage(response));
		}

		const payload = (await response.json()) as OpenAIEmbeddingResponse;

		if (!Array.isArray(payload.data) || payload.data.length !== inputs.length) {
			throw new Error(
				"OpenAI embeddings response did not contain the expected number of vectors.",
			);
		}

		// The API does not guarantee response order, so realign by `index`.
		const ordered = [...payload.data].sort((left, right) => left.index - right.index);

		return ordered.map((item) => {
			if (!Array.isArray(item.embedding)) {
				throw new Error("OpenAI embeddings response contained a malformed vector.");
			}

			return item.embedding;
		});
	}

	return {
		async embed(input: string): Promise<Array<number>> {
			// OpenAI rejects empty input, so fail fast with a clear message.
			if (input.length === 0) {
				throw new Error("OpenAI embeddings require a non-empty input string.");
			}

			const [vector] = await requestEmbeddings([input]);

			return vector;
		},

		async embedBatch(inputs: ReadonlyArray<string>): Promise<Array<Array<number>>> {
			if (inputs.length === 0) {
				return [];
			}

			inputs.forEach((value, index) => {
				if (value.length === 0) {
					throw new Error(
						`OpenAI embeddings require non-empty input strings (index ${index} was empty).`,
					);
				}
			});

			// Chunk to stay within the provider's per-request input limit.
			const vectors: Array<Array<number>> = [];

			for (let start = 0; start < inputs.length; start += MAX_INPUTS_PER_REQUEST) {
				const chunk = inputs.slice(start, start + MAX_INPUTS_PER_REQUEST);
				vectors.push(...(await requestEmbeddings(chunk)));
			}

			return vectors;
		},
	};
}

async function formatErrorMessage(response: Response): Promise<string> {
	const status = `${response.status} ${response.statusText}`.trim();
	let detail = "";

	try {
		const body = (await response.json()) as OpenAIErrorResponse;
		detail = body.error?.message ?? "";
	} catch {
		// Body was not JSON (e.g. a gateway error); fall back to status only.
	}

	return detail
		? `OpenAI embeddings request failed (${status}): ${detail}`
		: `OpenAI embeddings request failed (${status}).`;
}
