# Ant hive world event schema 1.0.0

All newly written audit, geometry, and run-log rows carry `schema_name`,
`schema_version`, `run_id`, `episode_id`, `arm_id`, `tick`, and `tick_key`.
`run_id` and `episode_id` are generated once from Node's cryptographic random
source, independently of every simulation RNG. `arm_id` comes from
`run-live.js --arm <name>` and defaults to `uninstructed`.

The engine currently has no reset or reseed boundary inside `run-live.js`.
An episode therefore honestly means one process invocation and has its own
stable ID, even though its lifetime currently matches the run lifetime. A
future in-process reset must create a new episode ID without changing the run
ID.

Analysis state is embedded on the event rather than reconstructed by replay.
Action audit rows include the stockpile after the action, tile/coordinates
when the action has one, and resource depletion where meaningful. Geometry
entries carry the same state at build time. Material discovery can span
several environmental source tiles, so it records `tile_ids` and uses
`tile_id` only when exactly one tile contributed. `tick_key` correlates rows
from one hive tick but is not required to reconstruct state.

Historical rows are not rewritten. Readers should call
`identifyEventRow(row)` from `event-schema.js`; a row without a recognized
schema name/version is returned with `contract_status: "pre-contract"` and
does not throw.
