# CacheLab

CacheLab is a semantic cache toolkit for TypeScript. It gives you a small client, pluggable storage adapters, embedding adapters, and a simple replay/evaluation path.

## Quick start

```ts
import {
	CacheLabClient,
	createInMemoryDatabaseAdapter,
	createOpenAIEmbeddingAdapter,
} from "cachelab";

// A built-in OpenAI adapter ships with the package
// // Any object implementing the EmbeddingAdapter contract works here too, see "Embeddings" below.
const embeddingAdapter = createOpenAIEmbeddingAdapter({
	apiKey: process.env.OPENAI_API_KEY!,
});

const client = new CacheLabClient({
	dbAdapter: createInMemoryDatabaseAdapter(),
	embeddingAdapter,
});

const result = await client.invoke({
	query: "How do I cache API responses?",
	compute: async () => callYourModelOrApi(),
});
```

`invoke` embeds the query, looks for a semantically similar cached entry, and
either returns the cached value or runs `compute` and stores its result.

## Embeddings

An embedding adapter implements two methods:

- `embed(input)` — embed a single string.
- `embedBatch(inputs)` — embed many strings in one request, returning one
  vector per input in the same order.

A built-in OpenAI adapter is included (more providers are planned):

```ts
const embeddingAdapter = {
	async embed(input: string): Promise<number[]> {
		return myEmbedder(input); // myEmbedder is your custom embedding logic
	},
	async embedBatch(inputs: string[]): Promise<number[][]> {
		return Promise.all(inputs.map(myEmbedder));
	},
};
```

### Seeding the cache

Use `seed` to load an initial set of saved query/value pairs. Queries are
embedded in **batched** requests by default; pass `{ batch: false }` to embed
them one-by-one.

```ts
await client.seed([
	{ query: "What are your hours?", value: "9am–5pm, Mon–Fri." },
	{ query: "Where are you located?", value: "123 Main St." },
]);

// Embed individually instead (e.g. to isolate a failing query):
await client.seed(savedQueries, { batch: false });
```

### Batching live queries

By default each `invoke` embeds its query immediately (lowest latency). To
coalesce concurrent end-user queries into shared embedding requests, pass a
`batching` config — a batch flushes when either `maxBatchSize` inputs are
buffered or `maxWaitMs` elapses, whichever comes first:

```ts
const client = new CacheLabClient({
	dbAdapter,
	embeddingAdapter,
	batching: { maxBatchSize: 16, maxWaitMs: 20 },
});
```

This trades a little latency (up to `maxWaitMs`) for fewer, larger requests.
Note that if a coalesced batch request fails, every query in that batch rejects
with the same error.

> **OpenAI input limit:** the OpenAI embeddings endpoint accepts at most **2048
> inputs per request**. The OpenAI adapter's `embedBatch` handles this for you —
> larger batches (e.g. big `seed` uploads) are transparently split into
> 2048-input chunks and stitched back together in order. This is independent of
> the `batching.maxBatchSize` coalescing setting above.

## Storage

A database adapter stores cache entries and answers `findBestMatch(embedding,
threshold)` with the nearest entry by cosine similarity. We currently have 3 built-in:

```ts
import {
	createInMemoryDatabaseAdapter,
	createPostgresDatabaseAdapter,
	createPineconeDatabaseAdapter,
} from "cachelab";
```

### Pinecone

```ts
const dbAdapter = createPineconeDatabaseAdapter({
	apiKey: process.env.PINECONE_API_KEY!,
	indexName: "cachelab", 
	namespace: "production", 
	vectorDimensions: 1536,
	cloud: "aws",
	region: "us-east-1",
});
// namespace: Optional, scope every read and write to one namespace.
// vectorDimensions: Only used if `initialize()` has to create the index.

// Creates the index if it does not exist yet, then waits for it to be ready.
await dbAdapter.initialize?.();
```

The adapter talks to Pinecone's REST API directly, so there is no extra dependency. Things
worth knowing:

- **The index must use the `cosine` metric.** CacheLab reads match scores as
  cosine similarities, so an index on another metric is rejected with a clear
  error. `initialize()` creates cosine serverless indexes.
- **`initialize()` is optional** if the index already exists — the adapter
  resolves the data-plane host on its first request. Pass `host` to skip that
  lookup entirely.
- **Writes are eventually consistent.** An `upsert` is acknowledged before it
  becomes queryable, so an immediate `invoke` on the same query may still miss.
- **`vectorDimensions` must match your embedding model** (1536 for
  `text-embedding-3-small`, 3072 for `text-embedding-3-large`).
- `value` and `metadata` are stored as JSON strings, since Pinecone metadata
  only holds strings, numbers, booleans, and string lists.
- `getAll()` pages through the index with `vectors/list`, which serverless
  indexes support (pod-based indexes do not).

Its integration tests read `TEST_PINECONE_API_KEY`, and optionally
`TEST_PINECONE_INDEX` and `TEST_PINECONE_NAMESPACE`.

## Scripts

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run typecheck`
