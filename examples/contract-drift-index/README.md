# Contract drift index (parked example)

Until 3.9 the gantry CLI carried an optional local index of contract embeddings: `gantry contract embed`,
`gantry contract propose --embedding-file`, `gantry legislate --from-intent --embedding-file | --auto-embed`. It warned
when a new mission's intent sat close to an earlier contract. Nobody used it in a gate, and it pulled two native modules
(`better-sqlite3`, `sqlite-vec`) into every install, so ADR-0052 A10 parks it here. The CLI no longer ships it.

What is here:

- `src/vector-store.ts`: the sqlite-vec store (`.gitagent/planner/contracts.sqlite`, 1536-dimension vectors).
- `src/embedding-provider.ts`: the OpenAI embedding call (`OPENAI_API_KEY`) and the host embedding file format.
- `src/contract-drift.ts`: `readHostEmbedding` and `indexProposedContract` (query neighbours, then upsert).
- `tests/`: the unit tests as they ran inside the CLI tree. They import a few CLI internals (`contractSha256`,
  `proposeContract`, `loadManifest`) and are kept for the record; wire them to your own copies before running.

To use it, build this folder (`npm ci && npm run build`) and call `indexProposedContract` with the contract digest
`gantry contract propose --json` prints and a host embedding; `OPENAI_API_KEY` is needed only for
`OpenAiEmbeddingProvider`.
