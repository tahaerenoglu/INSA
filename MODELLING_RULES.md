# Shared modelling rules

These rules execute in the BIM command factory for every project and every authoring tool, including MCP and web API. They are part of the original command's governed proposal, not follow-up repair proposals.

- Storey-constrained walls and vertical structural columns follow horizontal supporting floor tops and target-floor undersides. Slab holes and stair landings do not count as supporting floors.
- Fixed-height walls and columns are trimmed when their requested extent intersects those floor surfaces. Shorter fixed elements are not extended. They retain fixed intent.
- Wall endpoint corners and endpoint-to-segment tees are joined automatically within the authoring transaction. Explicit join/unjoin commands retain their own semantics.
- New wall-axis crossings inside both segments are rejected atomically. Authors must split the walls to create an endpoint junction.
- Hosted openings and their fills retain the existing host validation and IFC opening subtraction.
- IFC/Fragments use the existing structural subtraction rules for column/wall, beam/wall, beam/slab and beam/column interfaces. These geometry cuts are separate from gross quantity reporting.
- New geometry cannot duplicate an existing physical solid. Wall direction, polygon winding and polygon start vertex do not bypass the check. Virtual rooms/spaces and hosted references remain governed by their own occupancy/host rules.
- Unambiguous free wall corners are reconciled only within the neighbouring thickness envelope (at most 300 mm), then explicitly joined in the original command. Parallel walls and vertically separate elements are never proximity-snapped. Hosted start-relative coordinates are protected.
- A shared corner uses both wall thicknesses when deriving its miter. Plan, IFC and Fragments consume the same footprint.
- Parallel positive-volume wall overlaps and interpenetrating generic component boxes are rejected on create/edit/type changes. Face contact is permitted; overlapping axis-aligned boxes alone are not a collision proof. A legacy conflict may be reduced, never enlarged, during incremental repairs.
- Boundary solids (floors, ceilings and roofs, including holes/inclined facets) have deterministic volume ownership in IFC/Fragments. Finish/ceiling surfaces precede roof shells, then floors; thinner layers and stable IDs break ties. Solid differences partition intersections without combining object identities. Walls are also cut against those boundary solids. This is derived geometry, not event-log rewriting.
- `bim_reconcile_model` previews/proposes one atomic repair of redundant equal-height, single-material parallel walls and safe wall-corner gaps. Hosted/assembly references prevent deletion. Existing joins are disconnected and surviving neighbours are rejoined inside the same governed transaction. Ambiguous cases are left for explicit editing. A second repair of a reconciled model produces no events.

Scope: supported wall junctions, generic oriented boxes, duplicate physical representations, and derived boundary/structural solid interfaces described above. This does not certify arbitrary free-form solids, swept MEP-route clearances, structural adequacy or construction tolerances. Intentional contact is distinct from duplicate/interpenetrating physical geometry. Explicit unjoin remains an intermediate authoring operation.

Universal Modeling Brain additions (2026-10-23):
- An explicitly attached wall (`topRoof`) follows the underside of one single-plane roof. The dependency is persisted on the existing wall; quantities and IFC/Fragments derive the live plane. Deleting an attached roof is refused. Roof/type/storey edits revalidate dependent walls and hosted openings transitively.
- High-level generated upright rectangular-column reinforcement opts into `geometryValidation: rectangular_column`. Bar outer surfaces must remain inside the supplied cover prism, including rotated columns; subsequent host/type changes are revalidated. Historic unverified bar sets remain marked as unverified. This is a geometric rule, not reinforcement design or code compliance.
- Closed filleted bar paths round their closure corner as well as the other corners. Rebar resources export an IfcReinforcingBarType and bar occurrences retain the shared type relationship.
- Universal service routes try deterministic orthogonal permutations against conservative building-solid bounds. Riser paths must use actual slab openings. No structural penetrations are created; an obstructed request fails atomically. This bounded search is not a general-purpose routing solver.

Regression gate: `node --test --import tsx packages/bim/test/wall-slab-batch.test.ts`.
Extended regression gate: `node --test --import tsx packages/bim/test/modelling-policy.test.ts packages/bim/test/wall-slab-batch.test.ts` (includes a real IFC union-volume check).
