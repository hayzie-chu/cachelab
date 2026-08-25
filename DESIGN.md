# Design notes

A running record of decisions that were not obvious at the time, why we landed where we did, and what would make us revisit them. Implementation details live in the code and the README; this file is for the reasoning behind them.

---

## Pinecone: raw REST over the official SDK

**Decision:** [`src/adapters/db/providers/pinecone.ts`](src/adapters/db/providers/pinecone.ts) talks to Pinecone's HTTP API with `fetch` instead of depending on `@pinecone-database/pinecone`.

**Why.** CacheLab is a published library, so every runtime dependency we take becomes a transitive dependency for everyone who installs us. Pinecone's data plane is five JSON endpoints (`query`, `vectors/upsert`, `vectors/fetch`, `vectors/list`, `vectors/delete`) plus two on the control plane, so it's small enough to own outright. This also keeps the adapter consistent with [`openai.ts`](src/adapters/embeddings/openai.ts), which calls the embeddings endpoint the same way.

**The counter-argument we weighed.** `pg` is already a runtime dependency, so we are not zero-dep on principle and "no new dependencies" alone would have been a weak reason. What makes the two cases different is scope: Postgres speaks a binary wire protocol nobody should reimplement, while Pinecone speaks JSON over HTTP. 

**Comparison:**

| | `fetch` (current) | `@pinecone-database/pinecone` |
| --- | --- | --- |
| Install cost for consumers | none | a dep plus its transitives, on every install |
| API drift | ours to track when Pinecone rev's its API version | Pinecone's to track, we just bump a version |
| Retries / backoff on 429 & 5xx | **none today** | some, built in |
| Request/response types | hand-written, can silently drift from reality | generated, guaranteed to match |
| Connection reuse | Node's global undici dispatcher keeps connections alive | same |
| Debuggability | one file, no indirection | stack traces through SDK layers |

**Notable loss: retries** 
Pinecone serverless rate-limits, and currently a 429 or a transient 5xx surfaces as a thrown error straight out of `invoke`. We have 2 options, in the order we would try them:

1. Add bounded retry with exponential backoff and jitter to `dataPlaneRequest`, honouring    `Retry-After` when present. Roughly twenty lines, contained to one function, and it would fix the same gap in [`postgres.ts`](src/adapters/db/providers/postgres.ts) if lifted into a shared helper.
2. Switch to the SDK if we find ourselves reimplementing more of it than retries, using pagination helpers, index lifecycle polling, or per-operation limit handling. This is a signal that the surface stopped being small. We can consider suggesting this to the user if this happens, or dynamically changing it ourselves.

Pinning `X-Pinecone-Api-Version` (currently `2025-04`, overridable via `apiVersion`) is what
protects us from silent API drift in the meantime. Bumping it should be a deliberate, tested
change rather than a default that moves under us.

---

## How much of the vector database we actually use

tl;dr: 
- use well: search, write, scan
- not well: [`DatabaseAdapter`](src/adapters/db/types.ts) interface rather than the provider.

**What we do well.** Approximate nearest-neighbour search server-side with `topK: 1`, so we
never pull vectors client-side to compare them. Cosine enforced at the index, so match scores
are directly comparable to the caller's threshold and the adapter rejects an index built on
another metric instead of silently returning wrong similarities. Namespaces for isolation,
including a cheap namespace-wide `deleteAll` behind `clear()`.

**What we can improve:**

- **Batch upsert.** [`client.ts`](src/client.ts) seeds one entry per `await`, so seeding a
  thousand entries is a thousand sequential round-trips. Pinecone accepts many vectors per
  upsert request (its docs recommend batches of around a hundred). This is the largest
  throughput gap we have.
- **Metadata-only updates.** Every cache hit bumps `hits` by re-`upsert`ing the whole entry —
  for a 1536-dimension embedding that is roughly six kilobytes of floats rewritten to
  increment a counter. Pinecone has a `vectors/update` endpoint for exactly this, but the
  adapter contract only exposes `upsert`, so we cannot reach it. This is also why
  `findBestMatch` sets `includeValues: true`: the returned floats are not needed for the cache
  decision, they exist so the write-back does not blank the vector.
- **Metadata filtering.** `value` and the caller's `metadata` are stored as JSON strings,
  because Pinecone metadata only holds strings, numbers, booleans, and string lists. Pinecone
  therefore cannot index or filter on them, and `findBestMatch(embedding, threshold)` has no
  filter parameter to pass anyway. Scoping a cache per tenant, model, or prompt version has to
  go through namespaces today.
- **Exact re-ranking.** Serverless search is approximate. With `topK: 1` there is no room to
  correct for that: if ANN returns the second-best neighbour we either serve a slightly worse
  but still above-threshold hit, or take a false miss and recompute. False misses are the safe
  direction, so nothing is incorrect — just occasionally suboptimal. Note this is not
  Pinecone-specific; the Postgres adapter's HNSW index is approximate too, and only
  [`in-memory.ts`](src/adapters/db/in-memory.ts) searches exactly.

**Two provider limits to design around**, as opposed to things we chose:

- Pinecone caps metadata at 40KB per vector, and that is where the cached `value` lives. Long
  responses will hit it. Postgres `JSONB` has no comparable practical limit, which is a real
  capability difference between the two backends rather than a flaw in either adapter.
- `getAll()` is `vectors/list` plus `vectors/fetch`, two requests per hundred entries, against
  one `SELECT *` in Postgres. Vector databases are not scan engines. It is fine for evaluation
  and debugging and wrong for anything on the hot path.

**Suggested changes**, ordered cheapest first, consider implementing on further checkpoints/MVPs:

1. **`topK: 3–5` plus a local exact cosine re-rank** in `findBestMatch`. We already pay for
   `includeValues`, so for small `k` this costs almost nothing and removes ANN error at the
   top of the list. Contained entirely to the Pinecone adapter.
2. **`upsertMany` on `DatabaseAdapter`**, with `seed()` calling it. Pinecone chunks into
   ~100-vector requests, Postgres into a multi-row `INSERT`, in-memory just loops. Both remote
   adapters benefit, and it is the one change that turns seeding from minutes into seconds.
3. **A metadata-only update path** — `touch(id, { hits, updatedAt })` or similar — so a cache
   hit stops rewriting the vector. Postgres maps it to a narrow `UPDATE`, Pinecone to
   `vectors/update`, and it would let `findBestMatch` drop `includeValues` once nothing needs
   the round-tripped floats.
4. **A filter argument on `findBestMatch`**, if per-tenant or per-model scoping becomes a real
   requirement. This one is a genuine interface change: it needs first-class metadata columns
   rather than an opaque JSON blob, so it should wait until someone actually needs it.

Items 2 through 4 touch all three adapters, so they are interface decisions to make
deliberately rather than adapter-local fixes.

---

## Where the similarity threshold lives

**Decision:** the threshold is a caller-supplied argument, adapters never default it. They only
receive it, compare with `similarity >= threshold`, and report `threshold-met` or
`threshold-not-met` identically across Pinecone, Postgres, and in-memory. The single default,
`0.8`, is set once in [`client.ts`](src/client.ts) and is overridable per call via
`invoke({ threshold })`.

Keeping the number in one place is what makes the three backends interchangeable: swapping
adapters must not change which queries hit.

**Worth considering: a default per embedding provider and model.** A flat `0.8` is a rough
guess dressed up as a default. Cosine similarity is not comparable across embedding models as
OpenAI's models skew high even for loosely related text, so `0.8` is fairly permissive there
and semantic caches on them are usually tuned to somewhere in `0.85`–`0.95`, while a model
with a wider spread would want a lower number. A user who switches embedding models keeps the
same threshold and silently gets a different hit rate.

A reasonable shape would be for the embedding adapter to advertise a suggested threshold
alongside its vectors, like an optional field on `EmbeddingAdapter`, defaulted per model in the
OpenAI adapter, with the client falling back to the current constant when the adapter offers
nothing, and an explicit `invoke({ threshold })` still winning over both. That keeps the
comparison itself in one place while letting the default track the model that produced the
vectors.

This is different from the dynamic threshold we would suggest to the client in our reports after they've been using this for a while. This is the initial default suggestion based on our own research and common practices.

