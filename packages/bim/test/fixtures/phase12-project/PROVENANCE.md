# Phase 12 fixture project

Generated from the **untouched closed Phase 12 baseline** (checkpoint `/tmp/insa-p13-before`), **before any Phase 13 persistence change**
(no MepSystem / MepJunction, BIM_STATE_VERSION 5, ElementCreated 3, ElementUpdated 2). FileStores layout, project id `phase12`.

Contents: storeys L0 / L1 (L1 3.2 -> 3.1 in the history); the Phase 11 content (joined perimeter, partition + door with a Phase 10 T trim, split + merge,
extend, windows, rectangular and circular columns, beams, floor with a hole, ceiling, flat and sloped roof, stair, railing, furniture family + component,
room and space) PLUS the Phase 12 structural content: an RHS brace between two storeys, a pile, a shear wall (split by Phase 10), a structural slab, a foundation
slab, a pad footing, an I-section beam. Includes an update, a move, a storey change and an UNDONE column update; snapshots at seq 129 / 150 / 165.

`phase12-oracle/` holds what the Phase 12 code itself computed for the final state: every element's quantities and usage, spatial resolutions, the
structural connectivity query result and the IFC export. Tests copy this directory; never edit it.
