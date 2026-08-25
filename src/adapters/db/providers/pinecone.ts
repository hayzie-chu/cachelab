// Pinecone database adapter.
import type { CacheDecision, CacheEntry } from "../../../types";
import type { DatabaseAdapter } from "../types";

export interface PineconeDatabaseAdapterOptions {
	apiKey: string;
	indexName: string;
	/**
	 * Namespace to scope every read and write to. Defaults to Pinecone's default
	 * namespace.
	 */
	namespace?: string;
	/**
	 * Data-plane host for the index (e.g. `my-index-abc123.svc.aped-1234.pinecone.io`).
	 * Pass it to skip the control-plane lookup that otherwise resolves it.
	 */
	host?: string;
	/** Required for `initialize` to create the index when it does not exist yet. */
	vectorDimensions?: number;
	/** Serverless placement used when `initialize` creates the index. */
	cloud?: "aws" | "gcp" | "azure";
	region?: string;
	controlPlaneUrl?: string;
	apiVersion?: string;
}

interface PineconeIndexDescription {
	name: string;
	host: string;
	dimension: number;
	metric: string;
	status?: {
		ready?: boolean;
		state?: string;
	};
}

interface PineconeRecord {
	id: string;
	values?: Array<number>;
	metadata?: Record<string, unknown>;
}

interface PineconeQueryResponse {
	matches?: Array<PineconeRecord & { score?: number }>;
}

interface PineconeFetchResponse {
	vectors?: Record<string, PineconeRecord>;
}

interface PineconeListResponse {
	vectors?: Array<{ id: string }>;
	pagination?: {
		next?: string;
	};
}

interface PineconeErrorResponse {
	message?: string;
	error?: {
		message?: string;
	};
}

const DEFAULT_CONTROL_PLANE_URL = "https://api.pinecone.io";
const DEFAULT_API_VERSION = "2025-04";
const DEFAULT_CLOUD = "aws";
const DEFAULT_REGION = "us-east-1";
// `vectors/list` pages IDs; `vectors/fetch` then hydrates one page at a time.
const LIST_PAGE_SIZE = 100;
const INDEX_READY_TIMEOUT_MS = 120_000;
const INDEX_READY_POLL_INTERVAL_MS = 1_000;

export function createPineconeDatabaseAdapter<TValue>(
	options: PineconeDatabaseAdapterOptions,
): DatabaseAdapter<TValue> {
	const apiKey = options.apiKey?.trim();

	if (!apiKey) {
		throw new Error("createPineconeDatabaseAdapter requires a non-empty apiKey.");
	}

	if (!options.indexName?.trim()) {
		throw new Error("createPineconeDatabaseAdapter requires a non-empty indexName.");
	}

	const indexName = options.indexName.trim();
	const namespace = options.namespace;
	const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
	const controlPlaneUrl = (options.controlPlaneUrl ?? DEFAULT_CONTROL_PLANE_URL).replace(
		/\/+$/,
		"",
	);

	const headers = {
		"Api-Key": apiKey,
		"Content-Type": "application/json",
		"X-Pinecone-Api-Version": apiVersion,
	};

	// Resolved once and reused; the data-plane host never changes for an index.
	let hostPromise: Promise<string> | undefined;

	if (options.host) {
		hostPromise = Promise.resolve(normalizeHost(options.host));
	}

	async function describeIndex(): Promise<PineconeIndexDescription | undefined> {
		const response = await fetch(
			`${controlPlaneUrl}/indexes/${encodeURIComponent(indexName)}`,
			{
				method: "GET",
				headers,
			},
		);

		if (response.status === 404) {
			return undefined;
		}

		if (!response.ok) {
			throw await requestError("describe index", response);
		}

		return (await response.json()) as PineconeIndexDescription;
	}

	async function resolveHost(): Promise<string> {
		hostPromise ??= describeIndex().then((description) => {
			if (description === undefined) {
				throw new Error(
					`Pinecone index "${indexName}" does not exist. Call initialize() to create it, or pass an existing index name.`,
				);
			}

			assertCosineMetric(description);

			return normalizeHost(description.host);
		});

		try {
			return await hostPromise;
		} catch (error) {
			// Don't cache the failure — a later initialize() may create the index.
			hostPromise = undefined;
			throw error;
		}
	}

	// Every data-plane call goes through here so the host lookup stays lazy.
	async function dataPlaneRequest(
		operation: string,
		path: string,
		init: { method: "GET" | "POST"; body?: unknown; query?: URLSearchParams },
	): Promise<Response> {
		const host = await resolveHost();
		const query = init.query?.toString();
		const url = `https://${host}${path}${query ? `?${query}` : ""}`;

		const response = await fetch(url, {
			method: init.method,
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});

		if (!response.ok) {
			throw await requestError(operation, response);
		}

		return response;
	}

	function namespaceBody(body: Record<string, unknown>): Record<string, unknown> {
		return namespace === undefined ? body : { ...body, namespace };
	}

	function namespaceQuery(query: URLSearchParams): URLSearchParams {
		if (namespace !== undefined) {
			query.set("namespace", namespace);
		}

		return query;
	}

	async function fetchByIds(ids: ReadonlyArray<string>): Promise<Array<PineconeRecord>> {
		if (ids.length === 0) {
			return [];
		}

		const query = new URLSearchParams();

		for (const id of ids) {
			query.append("ids", id);
		}

		const response = await dataPlaneRequest("fetch vectors", "/vectors/fetch", {
			method: "GET",
			query: namespaceQuery(query),
		});

		const payload = (await response.json()) as PineconeFetchResponse;

		return Object.values(payload.vectors ?? {});
	}

	return {
		async initialize(): Promise<void> {
			const existing = await describeIndex();

			if (existing !== undefined) {
				assertCosineMetric(existing);
				hostPromise = Promise.resolve(normalizeHost(existing.host));
				return;
			}

			if (options.vectorDimensions == null) {
				throw new Error(
					`Pinecone index "${indexName}" does not exist. Pass vectorDimensions so initialize() can create it, or create the index yourself.`,
				);
			}

			const response = await fetch(`${controlPlaneUrl}/indexes`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					name: indexName,
					dimension: options.vectorDimensions,
					// findBestMatch reads match scores as cosine similarities.
					metric: "cosine",
					spec: {
						serverless: {
							cloud: options.cloud ?? DEFAULT_CLOUD,
							region: options.region ?? DEFAULT_REGION,
						},
					},
				}),
			});

			if (!response.ok) {
				throw await requestError("create index", response);
			}

			hostPromise = Promise.resolve(
				normalizeHost(await waitUntilReady(describeIndex, indexName)),
			);
		},

		// Nothing to tear down: the adapter holds no pooled connections.
		async close(): Promise<void> {},

		async findBestMatch(
			queryEmbedding: ReadonlyArray<number>,
			threshold: number,
		): Promise<CacheDecision<TValue>> {
			const response = await dataPlaneRequest("query", "/query", {
				method: "POST",
				body: namespaceBody({
					vector: [...queryEmbedding],
					topK: 1,
					includeValues: true,
					includeMetadata: true,
				}),
			});

			const payload = (await response.json()) as PineconeQueryResponse;
			const match = payload.matches?.[0];

			if (match === undefined) {
				return {
					hit: false,
					similarity: 0,
					threshold,
					entry: undefined,
					reason: "no-candidate",
				};
			}

			// Cosine indexes return the similarity directly as the match score.
			const similarity = Number(match.score ?? 0);

			if (similarity >= threshold) {
				return {
					hit: true,
					similarity,
					threshold,
					entry: recordToEntry<TValue>(match),
					reason: "threshold-met",
				};
			}

			return {
				hit: false,
				similarity,
				threshold,
				entry: undefined,
				reason: "threshold-not-met",
			};
		},

		async getAll(): Promise<Array<CacheEntry<TValue>>> {
			const entries: Array<CacheEntry<TValue>> = [];
			let paginationToken: string | undefined;

			do {
				const query = new URLSearchParams({ limit: String(LIST_PAGE_SIZE) });

				if (paginationToken !== undefined) {
					query.set("paginationToken", paginationToken);
				}

				const response = await dataPlaneRequest("list vectors", "/vectors/list", {
					method: "GET",
					query: namespaceQuery(query),
				});

				const payload = (await response.json()) as PineconeListResponse;
				const ids = (payload.vectors ?? []).map((vector) => vector.id);
				const records = await fetchByIds(ids);

				entries.push(...records.map((record) => recordToEntry<TValue>(record)));

				paginationToken = payload.pagination?.next;
			} while (paginationToken !== undefined && paginationToken !== "");

			return entries;
		},

		async getById(id: string): Promise<CacheEntry<TValue> | undefined> {
			const [record] = await fetchByIds([id]);

			return record ? recordToEntry<TValue>(record) : undefined;
		},

		async upsert(entry: CacheEntry<TValue>): Promise<void> {
			await dataPlaneRequest("upsert", "/vectors/upsert", {
				method: "POST",
				body: namespaceBody({
					vectors: [entryToRecord(entry)],
				}),
			});
		},

		async remove(id: string): Promise<void> {
			await dataPlaneRequest("delete vectors", "/vectors/delete", {
				method: "POST",
				body: namespaceBody({ ids: [id] }),
			});
		},

		async clear(): Promise<void> {
			try {
				await dataPlaneRequest("delete vectors", "/vectors/delete", {
					method: "POST",
					body: namespaceBody({ deleteAll: true }),
				});
			} catch (error) {
				// Deleting everything in a namespace that was never written to 404s;
				// the namespace is already empty, so treat it as a no-op.
				if (!isNamespaceNotFound(error)) {
					throw error;
				}
			}
		},
	};
}

export type PineconeCacheEntry<TValue = unknown> = CacheEntry<TValue>;

function normalizeHost(host: string): string {
	return host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function assertCosineMetric(description: PineconeIndexDescription): void {
	if (description.metric !== "cosine") {
		throw new Error(
			`Pinecone index "${description.name}" uses the "${description.metric}" metric, but CacheLab compares entries by cosine similarity. Recreate the index with metric "cosine".`,
		);
	}
}

async function waitUntilReady(
	describeIndex: () => Promise<PineconeIndexDescription | undefined>,
	indexName: string,
): Promise<string> {
	const deadline = Date.now() + INDEX_READY_TIMEOUT_MS;

	for (;;) {
		const description = await describeIndex();

		if (description?.status?.ready === true) {
			return description.host;
		}

		if (Date.now() >= deadline) {
			throw new Error(
				`Pinecone index "${indexName}" was not ready within ${INDEX_READY_TIMEOUT_MS}ms.`,
			);
		}

		await sleep(INDEX_READY_POLL_INTERVAL_MS);
	}
}

function sleep(durationMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

// Pinecone metadata only holds strings, numbers, booleans, and string lists, so
// `value` and the caller's `metadata` object are stored as JSON text.
function entryToRecord<TValue>(entry: CacheEntry<TValue>): PineconeRecord {
	const metadata: Record<string, unknown> = {
		query: entry.query,
		value: JSON.stringify(entry.value ?? null),
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
		hits: entry.hits,
	};

	if (entry.metadata !== undefined) {
		metadata.metadata = JSON.stringify(entry.metadata);
	}

	return {
		id: entry.id,
		values: [...entry.embedding],
		metadata,
	};
}

function recordToEntry<TValue>(record: PineconeRecord): CacheEntry<TValue> {
	const metadata = record.metadata ?? {};

	return {
		id: String(record.id),
		query: String(metadata.query ?? ""),
		embedding: record.values ? [...record.values] : [],
		value: parseJson<TValue>(metadata.value),
		createdAt: String(metadata.createdAt ?? ""),
		updatedAt: String(metadata.updatedAt ?? ""),
		hits: Number(metadata.hits ?? 0),
		metadata:
			metadata.metadata === undefined
				? undefined
				: parseJson<Record<string, unknown>>(metadata.metadata),
	};
}

function parseJson<TParsed>(value: unknown): TParsed {
	if (typeof value !== "string") {
		return value as TParsed;
	}

	return JSON.parse(value) as TParsed;
}

function isNamespaceNotFound(error: unknown): boolean {
	return error instanceof PineconeRequestError && error.status === 404;
}

export class PineconeRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "PineconeRequestError";
	}
}

async function requestError(operation: string, response: Response): Promise<PineconeRequestError> {
	const status = `${response.status} ${response.statusText}`.trim();
	let detail = "";

	try {
		const body = (await response.json()) as PineconeErrorResponse;
		detail = body.error?.message ?? body.message ?? "";
	} catch {
		// Body was not JSON (e.g. a gateway error); fall back to status only.
	}

	const message = detail
		? `Pinecone ${operation} request failed (${status}): ${detail}`
		: `Pinecone ${operation} request failed (${status}).`;

	return new PineconeRequestError(message, response.status);
}
