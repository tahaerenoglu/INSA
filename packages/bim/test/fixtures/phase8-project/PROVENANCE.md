# Phase 8 fixture project

Produced by the **unmodified Phase 8 code** (repository snapshot taken at the start of Phase 9, run in
isolation with its own `@insa/*` links), FileStores layout, project id `phase8`:

- storeys L0, L1 (3.2 -> 3.4); wall / slab / column (rect + circle) / beam / door / window types;
- a 12 x 8 perimeter with explicit joins; a fixed partition W-0005 tee-joined at both ends (door in it);
  W-0006 with room_bounding: false (tee at one end); a window in W-0002; an empty opening in W-0003;
- columns C-0001 (constrained, rotated 30°) and C-0002 (circle, fixed, base offset) ; beams B-0001
  (constrained) and B-0002 (fixed z);
- slabs S-0001 (L1, with a hole) and S-0002 (L0 triangle, offset -0.05);
- HISTORICAL UPDATES: B-0002 end moved, C-0002 height + rotation, S-0001 offset, S-0002 moved, C-0001
  base offset changed and then UNDONE;
- a furniture family, a component type and two components; rooms 101 / 102 and space S1;
- the LAST snapshot taken explicitly at the final event (seq 105), BIM state version 4.

`phase8-oracle/` holds what the Phase 8 code itself computed for that final state: every element's
quantities, the spatial resolutions (status, area, perimeter, volume, region signature), every element's
usage, and its IFC export. Phase 9 is compared against these. Tests copy this directory; never edit it.
