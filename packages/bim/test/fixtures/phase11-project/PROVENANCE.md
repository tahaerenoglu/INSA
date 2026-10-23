# Phase 11 fixture project

Generated from the **untouched Phase 11 baseline** (the closed Phase 11 repository, checkpoint `/tmp/insa-p12-before`), **before any Phase 12
schema change**, with the FileStores layout, project id `phase11`. It is the migration oracle for Phase 12.

Contents: storeys L0 / L1 (L1 3.2 -> 3.1 in the history); a joined 12 x 8 perimeter, a partition with a door (trimmed to the south wall: a Phase 10
T junction), a split and a merge of the north wall, an extended wall; windows; beams, columns (rectangular and circular, constrained and fixed),
a floor with a hole, a ceiling, a flat and a sloped roof, a stair, a railing, a furniture family + component, a room and a space; an update, a
move, a storey change, a column update that is then UNDONE; snapshots at seq 108 / 129 / 133 (BIM state version 5).

`phase11-oracle/` holds what the Phase 11 code itself computed for the final state: every element's quantities and usage, the spatial resolutions
and the IFC export. Tests copy this directory; never edit it.
