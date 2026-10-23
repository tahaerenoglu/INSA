# Phase 7 fixture project

Produced by the **unmodified Phase 7 code** (repository snapshot taken at the start of Phase 8, run in
isolation with its own `@insa/*` links), FileStores layout, project id `phase7`:

- storeys L0 (0.0), L1 (3.2 -> 3.4); wall and door types;
- W-0001..W-0004: a closed 10 x 6 polyline perimeter whose four corners were JOINED explicitly;
- W-0005: a partition at x = 4, tee-joined to W-0001 and W-0003 (a door in it) — together these give
  two regions Phase 8 can detect (24 m² and 36 m², wall centerlines);
- W-0006..W-0009: a 4 x 4 square whose corners touch but were NEVER joined (no region in Phase 8);
- a furniture family, a component type and two components; storey-constrained walls follow L1;
- the LAST snapshot was taken explicitly at the final event (seq 62), with BIM state version 4.

No event describes rooms, spaces or room-bounding flags. Phase 8 must create NO spatial element on
replay (detection is not persistence) and, as its state version is still 4, may load these snapshots
directly: the snapshot-loaded state must equal the full replay. Tests copy this directory; never edit it.
