# Phase 13 fixture project

Generated from the **Phase 13 baseline plus the two targeted MEP closure corrections** (connector-scoped network query; system-isolated network at
connector-graph level), **before any Phase 14 state-schema or event change** (BIM_STATE_VERSION 6, ElementCreated 3, ElementUpdated 2). FileStores
layout, project id `phase13`. Checkpoint of the closed Phase 13 sources: `/tmp/insa-p14-before`.

Contents: storeys L0 / L1; the Phase 12 content (joined perimeter, partition + door with a Phase 10 T trim, split + merge, extend, windows, columns,
beams, floor with a hole, ceiling, flat and sloped roof, stair, railing, furniture component, room and space, RHS brace, pile, split shear wall,
structural slab, foundation slab, pad footing, I-section beam) PLUS MEP: four systems (piping WATER, piping SAN, hvac SA, electrical POWER); 8 pipes
(a WATER tee, a WATER triangle CYCLE, a SAN pipe, a WATER riser L0 -> L1), 2 conduits, a duct, a cable tray; ONE equipment component with four
connectors (water_in, drain: piping; power_in: electrical; spare: unconnected) connected into THREE different systems; 9 explicit junctions.
Includes an update, a move, a storey change and an UNDONE column update; snapshots at seq 191 / 212 / 233.

`phase13-oracle/` holds what this code computed for the final state: quantities, usage, spatial resolutions, structural connectivity, the IFC export
and `mep`: per-system summaries and network views, the equipment's whole-element / water_in / power_in network views, junctions and every connector.
In the corrected code the WATER view never contains the POWER or SAN junctions and `water_in` never follows `power_in`. Tests copy this directory;
never edit it.
