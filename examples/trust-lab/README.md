# Tidepool useful-work lab

An executable, disposable test bench for [Tidepool](https://github.com/TechyBen/tidepool). It does small real jobs, changes the behaviour of actors, and checks concrete evidence. It is not a deployed distributed trust network or a security proof.

The browser application is buildless: `dist/index.html`, local ES modules, and CSS. No dependencies, analytics, external APIs, wallet, or real money. The same scenario runner also runs with Node workers and filesystem storage.

## Run

With Node 22 or newer:

```sh
npm test
```

This executes 29 scenarios and additional arithmetic, signature, Merkle, custom-input, conservation, and incentive checks. Temporary files and the last JSON report are under ignored `.qa/`. The report contains fresh public keys and signatures; its contents and timings change between runs.

To serve the browser application locally, from this directory:

```sh
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080`. Web Crypto, module Workers, MessageChannel, and IndexedDB are required. A hosted deployment uses HTTPS. Do not open the HTML directly as `file://`.

Click **Run all 29 cases**, inspect individual decisions, and download the actual computed CSV, delivered payload, restored file, or signed evidence. Edit the input CSV or choose an 8-byte–128-KiB payload to make the work your own. A run export includes the input CSV and public evidence; inspect it before sharing sensitive data. File bytes stay in the browser unless the user downloads/shares an artifact.

## What actually runs

| Service | Actual operation | Acceptance check | Useful output |
| --- | --- | --- | --- |
| Energy budget | A worker parses a supplied CSV and computes exportable Wh per node | Separate arithmetic implementation checks every row against the committed input | Downloadable allocation-planning CSV; synthetic inputs are not real power telemetry |
| Delivery | A relay worker forwards bytes to a recipient worker over a transferred MessageChannel | Recipient hashes the received bytes and signs a contract-bound receipt; requester checks hash, length, pinned key, and nonce | Exact delivered bytes |
| Storage | Write actual chunks to IndexedDB, close/reopen, read challenged chunks, then restore all chunks | Merkle inclusion for the sample; independent full-file hash for restoration | Exact restored file |
| Local evidence | Persist author journals separately, follow required content-addressed dependencies | Pinned signatures, input contract, sequences, predecessors, dependencies, and bounded fetch policy | A three-object contract view without reading twelve unrelated events |
| Bounded funding | One in-memory scope authority serializes reservations; only new reservations execute real compute jobs | Capacity conservation, request binding, duplicate handling, and explicit delegated quotas | Authorized useful jobs and a local allocation transcript |
| Fraud reports | Verify two conflicting signed events at the same journal position | Both signatures and identity/journal/position must match the allegation; one reward per offense | Reproducible equivocation evidence, plus an explicit bounty-farming counterexample |

The default energy data gives `[200, 150, 550, 100, 25, 0, 220, 300]` Wh, total **1,545 Wh**. This known-answer fixture is checked separately from the worker/verifier implementation.

The storage tree is a small lab-specific SHA-256 Merkle construction, not a formal proof of retrievability or Chia/Filecoin implementation. It does not prove separate disks, geographic independence, long retention, or deletion by the requester. The bytes are really stored, but every actor is controlled by the same browser/process owner.

## Case map

The full executable catalog and regression expectations live in [dist/suite.mjs](dist/suite.mjs).

| Cases | Adversarial action or control | Required observation |
| --- | --- | --- |
| `compute.honest` | Compute the actual CSV | Correct rows and input commitment accepted |
| `compute.forged`, `compute.self-hash` | Inflate output, then compute a valid checksum and signature for the wrong answer | Correct checksum does not rescue wrong arithmetic |
| `compute.input-swap`, `compute.signature` | Substitute input; alter a result after signing | Input mismatch rejected; altered envelope invalid |
| `delivery.honest`, `delivery.corrupt` | Forward original or mutated payload | Destination receipt authenticates received bytes; altered content rejected |
| `delivery.replay`, `delivery.drop` | Old nonce; no message | Replay rejected; missing receipt incomplete, not proof of intent |
| `delivery.collusion` | Real local delivery with pinned common ownership | Local service allowed; no automatic sponsored outside demand |
| `storage.restore` | Store, reopen, sample, restore | Sample and complete file independently verified |
| `storage.missing`, `storage.corrupt`, `storage.bad-proof`, `storage.replay` | Delete, change, forge path, or reuse nonce | Missing bytes unavailable; failed integrity or freshness rejected |
| `storage.sample-miss` | Delete the last chunk, deliberately sample another | Sample passes and full restoration fails; this is a reproduced limit |
| `evidence.selective`, `evidence.omission`, `evidence.fork`, `evidence.budget` | Fetch branch, hide dependency, sign conflicting continuation, constrain budget | Supported, incomplete, conflict, incomplete respectively |
| `funding.race`, `funding.replay`, `funding.binding` | Competing reservations, duplicate request, changed contract | One eight-unit job; one four-unit allocation; changed binding rejected |
| `funding.sybil` | Ten aliases ask for three units each | Only three jobs / nine units fit the ten-unit scope |
| `funding.partition` | Compare copied balances against preallocated 6/4 quotas | Copied balances allocate 16; enforced quotas allocate at most 10 |
| `fraud.valid`, `fraud.false`, `fraud.repeat` | Real fork, altered evidence, duplicate report | Corroborated, invalid, duplicate |
| `fraud.self-farm` | Sign new offenses and self-report them | A proof-only bounty policy loses its two-unit budget; intentionally unsafe counterexample |

“Expected outcome reproduced” is a regression assertion. It does **not** mean a scheme is secure. Boundary cases pass their test by exposing a limitation. An attacker strategy changes actual work/evidence; the service verifier is not told whether an actor is a cheater. The catalog's expected outcome is used only after the decision to assert the regression result.

## Contract-to-code mapping

1. **Terms:** exact task, input hashes, quantity, actors, nonce, unit, and scope. Hash the lab's canonical term encoding into a contract ID. The illustrative lab wire format is versioned separately from the protocol draft.
2. **Acceptance:** requester and provider sign linked ask/accept events. Worker private signing keys remain in their worker and are non-extractable through Web Crypto. Public keys are pinned by the experiment coordinator, not inferred from arbitrary supplied evidence.
3. **Work:** call the runtime adapter. Work must produce bytes, computed results, or a concrete state transition. Mutations happen here or in supplied evidence.
4. **Verification:** verify envelope integrity and authorization, then the service's semantics against requester-held terms and input. A signature authenticates an assertion; it does not make it true.
5. **Accounting:** resource conservation and grant authority remain separate from useful-work proof. In-memory reservations must precede work execution. Lab units represent bounded test accounting, not transferable value.
6. **Observation:** expose the verdict, checks, actual work/verification duration, byte counts, relevant signed events, incomplete dependencies, and downloadable outputs.

The encoding sorts JSON object keys and permits only safe integer numbers. Hashing and signing use explicit domain strings, SHA-256, and ECDSA P-256 through Web Crypto. This is a constrained lab encoding, not a claim of RFC 8785 compatibility. There is no new consensus algorithm.

## Incentives: an experiment, not an equilibrium claim

The worker really either calculates the CSV or skips it and returns an empty answer. The run records an output commitment **before** selecting an audit. An audit performs actual recomputation. The simulator knows the attack schedule for observation; payment decisions use only the audit result or the configured no-audit policy.

For payment `R`, honest work cost `C`, audit probability `p`, and an assumed collectible penalty `L`:

```text
honest expected net = R - C
skip-work expected net = (1 - p) R - p L
honesty has the higher expected net iff p (R + L) > C
```

These are assumed test units, not measured resource consumption. Seeded scheduling makes a run reproducible and is intentionally **not** adversary-resistant randomness. The toy model assumes perfect recomputation when audited and collectible penalties, and excludes identity resets, collusion, verifier costs, and subjective work. Finite observed payoffs fluctuate. It cannot establish a Nash equilibrium or a secure protocol.

The default `R=5, C=2, p=0.5, L=0` gives expected honest net `3` and skip-work net `2.5`. Set audit probability to zero to observe skipped jobs receiving payment, or 100% to observe every skipped job rejected. Fully recomputing these tiny jobs costs roughly another computation; no computational-efficiency advantage is claimed for this service.

## Important limits and useful next experiments

- **One operator:** separate workers, keys, and store namespaces are not independent operators, machines, networks, or fault domains. Hidden collusion remains possible. The pinned operator registry only illustrates a known local/external distinction.
- **No durable authority:** the funding/bounty ledgers live in one process and reset between cases. IndexedDB/filesystem evidence survives reopening during a run, then temporary stores are deleted. Atomic journal/reservation/outbox commits, crash recovery, rollback fencing, and replicated agreement from the protocol sketch are not implemented.
- **Bounded scope:** the evidence test follows explicit dependencies and detects supplied forks. It cannot establish global completeness, find a withheld conflicting view, or prove a provider never failed elsewhere. Exported keys are self-contained experimental anchors, not externally authenticated identities.
- **Sampler limits:** deterministic fault fixtures deliberately request or miss a corrupted/deleted chunk. Honest samples use fresh crypto randomness after commitment. No statistical detection rate is inferred from these regression fixtures.
- **Fraud intent and reward:** a timeout or unavailable chunk is not proof of fraud. Signed equivocation is attributable to a key, but valid proof does not establish an independent whistleblower. The bounty-farming test intentionally demonstrates why automatic proof-only payouts are unsafe.
- **Common dependencies:** arithmetic worker and verifier have separate calculation logic but share the CSV parser, JS runtime and host. Golden results cover a few known cases; independent implementations and actual separate operators are needed for stronger assurance.
- **No LLM evaluator yet:** objective contracts are intentionally small. A later subjective task needs a rubric, blinded judges, disagreement/appeal handling, and bounded payment. Do not relabel an LLM vote as a cryptographic proof.

The next useful implementation step is an HTTP runtime adapter for the same cases, executed by separately controlled processes, with externally pinned keys and durable scoped authorities. Then test disconnects, process kills, stale snapshots, conflicting views, quota handoff, verifier capture, colluding endpoints, and real bandwidth/energy costs. Keep the regression harness and evidence verifier independent of the injected fault strategy.

## File map

- [dist/engine.mjs](dist/engine.mjs): crypto, journals, scoped evidence verification, reservation authority, sponsorship policy, bounty counterexample.
- [dist/work.mjs](dist/work.mjs): actual compute, independent arithmetic verifier, payload chunking and Merkle checking.
- [dist/agent.mjs](dist/agent.mjs): worker identity, compute and relay/recipient operations; browser/Node-compatible.
- [dist/browser-runtime.mjs](dist/browser-runtime.mjs): worker RPC, MessageChannel delivery and actual IndexedDB storage.
- [dist/suite.mjs](dist/suite.mjs): 29 executable cases and the incentive experiment.
- [dist/app.mjs](dist/app.mjs): interface, input handling and downloadable results.
- [tests/node-runtime.mjs](tests/node-runtime.mjs): worker_threads and actual filesystem storage adapter.
- [tests/run.mjs](tests/run.mjs): executable regression, known-answer and conservation checks.

References: [Web Crypto](https://www.w3.org/TR/webcrypto/), [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API). Tidepool's [protocol sketch](https://github.com/TechyBen/tidepool/blob/main/docs/protocol/local-ledgers-v0.md) remains the broader proposed architecture; the lab implements only the bounded mechanisms described here.
