# Tidepool

Exploring a distributed trust network of trade: resource-owning nodes exchange useful services and resilience through agents with explicit limits.

## Example case

Read [Distributed trust network of trade](docs/examples/distributed-trust-network-of-trade.md).

Explore [Network health and adaptive topology: a toy model](docs/examples/network-health-toy-model.md) for local hubs, alternate routes, newcomer contributions, and protocol improvement.

Read the [v0 protocol sketch: local ledgers and evidence on demand](docs/protocol/local-ledgers-v0.md) for signed journals, selective replication, request-specific evidence, and scoped allocation accounting.

Run the [useful-work lab and executable test suite](examples/trust-lab/README.md): real CSV computation, worker-to-worker byte delivery, storage/retrieval, scoped evidence, bounded funding, and 29 cooperation, attack, and boundary scenarios. The browser interface also explores audit incentives with actual computed results and explicitly assumed payoffs. [Open the hosted lab](https://tidepool-trust-lab.techyben.chatgpt.site) (owner-private access).

The example considers nodes with power, compute, storage, and communications; optional LLM agents; proof of useful task completion; and trust scoped to a resource, quantity, counterparty, and time window. Here, “PoW” means independently verifiable delivery, computation, or storage service.

The proposed first draft uses local resource enforcement, service-specific verification, and bilateral contracts, with AT Protocol evaluated for identity, discovery, and synchronisation. Surplus capacity and donations can fund bounded trial allowances for newcomers; observed results support gradual increases in access. Service earnings or explicitly funded grants can support hardware purchases and maintenance. Power is an operating input to those provisions.

Broad useful participation, independent recovery paths, and improvements to network health are explicit goals. Efficient hubs can coexist with distributed control and tested alternatives; raw identity count earns no automatic reward.

**Status:** design draft plus an executable single-machine laboratory, updated 25 October 2026. The lab performs small real operations and measures its own runs; it is not a deployed distributed protocol, a performance forecast, or a security proof. Production identity, independent operators, durable allocation agreement, and crash recovery remain unimplemented.
