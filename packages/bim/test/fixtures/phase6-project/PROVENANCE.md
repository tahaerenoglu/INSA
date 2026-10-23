# Phase 6 fixture project

Produced by the **unmodified Phase 6 code** (repository snapshot taken at the start of Phase 7, run in
isolation with its own `@insa/*` links), FileStores layout, project id `phase6`:

- storeys L0 (0.0), L1 (3.2 -> 3.4); wall / slab / column / beam / door / window types;
- W-0001, W-0002 storey-constrained to L1, W-0003 fixed 2.7 m;
- an endpoint junction W-0001.end <-> W-0002.start and a T-junction W-0003.start on W-0001;
- a window in W-0002, a door in W-0001; a constrained column and beam; a slab on L1;
- W-0001.end moved afterwards (the junction and the tee propagated);
- the LAST snapshot was taken explicitly at the final event (createSnapshot), with BIM state version 3.

No event describes families or components. Phase 7 must ignore the version-3 snapshots and its
full replay must equal the state stored in the last snapshot (apart from the new empty `families`).
Tests copy this directory before use; never edit it.
