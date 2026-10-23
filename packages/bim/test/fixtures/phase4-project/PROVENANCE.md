# Phase 4 fixture project

Produced by the **unmodified Phase 4 code** (snapshot of the repository taken at the start of Phase 5,
run in isolation with its own `@insa/*` links), FileStores layout, project id `phase4`:

- storeys L0 (0.0), L1 (3.0), L2 (6.0, renamed "Çatı");
- wall W-0001 created **without height** (Phase 4 stored the next-storey value 3.0 as a plain number),
  wall W-0002 with explicit height 2.7, a window in W-0001;
- column C-0001 without height, beam B-0001 without z (both stored as plain numbers);
- snapshots at seq 12, 20, 26 written with BIM state version 1.

No event carries vertical intent. Phase 5 must read every element as **fixed** and ignore the
version-1 snapshots (state version 2). Tests copy this directory before use; never edit it.
