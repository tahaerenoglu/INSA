# Phase 5 fixture project

Produced by the **unmodified Phase 5 code** (repository snapshot taken at the start of Phase 6, run in
isolation with its own `@insa/*` links), FileStores layout, project id `phase5`:

- storeys L0 (0.0), L1 (3.0 -> 3.2);
- W-0001..W-0004: a closed polyline perimeter 10 x 8 m (Phase 5 stored prevDir / nextDir mitre
  hints and exactly coincident corners);
- W-0005 / W-0006: two separate walls whose endpoints coincide exactly at (26, 0);
- W-0007: a wall whose start touches the middle of W-0001 at (4, 0);
- W-0008 / W-0009: two walls crossing at (33, 3);
- a window in W-0002; storey-constrained walls follow L1 (3.2);
- snapshots written with BIM state version 2.

No event describes topology. Phase 6 must load this with NO joins (touching is not joining), keep every
coordinate and mitre hint, ignore the version-2 snapshots, and only REPORT candidates on request.
Tests copy this directory before use; never edit it.
