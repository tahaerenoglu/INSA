# CivilNavigators

Existing Shared Tool Registry exposes the same tools to MCP, HTTP tools UI, and the in-app assistant:

- `infra_navigate_alignment`: `{alignment:"AL-001", action:"go_to", station:"22+300", labels:true, label_interval:100, camera_distance:60}`. Actions: `show`, `go_to`, `hide`. `show` opens at the alignment start unless a station is supplied. `go_to` requires a station. Units: metres; station is horizontal engineering chainage.
- `infra_query_navigation`: `{}` reads the last saved navigation request.

Natural-language examples: “AL-001 üzerinde 22+300'e git”, “Kilometraj etiketlerini göster”, “Güzergâhta gezinmeyi kapat”. The assistant discovers alignment IDs from existing summary tools. It must not create geometry just to move the camera.

Navigation is a shared project view setting (`CivilNavigationSet`), not geometry. Existing command permissions, AI approval, audit, undo and replay apply. In AI approval mode, a proposal must be approved before open clients move. All clients viewing the same project receive the change via the existing SSE refresh. Reload reopens the saved view. Existing snapshots/projects without the optional field remain supported. Geometry cache keys exclude navigation.

`OBF.CivilNavigators` and `CivilRaycaster` use the existing ThatOpen World. `RendererWith2D` adds official CSS2D label rendering. `OBF.Marker` places station labels at canonical evaluated points, because the installed CivilNavigator built-in label accumulation uses 3D chord lengths. Tool station targets and labels are computed by the existing INSA alignment evaluator; pointer picks are polyline interpolations and explicitly marked approximate. No geometry engine or MCP server is added.

The left sidebar contains “Güzergâhta gezin · CivilNavigator”; its buttons call the same shared tool. Cross-section and synchronized secondary plan views are outside this change; the existing real solid cross-section panel remains available.

Verification: `node --test --import tsx apps/web-server/test/civil-navigation.test.ts apps/web-server/test/infrastructure.test.ts`, `npm run typecheck`, `npm run build:web`. Browser fixture `tmp/pdfs/rail-008/civil-browser-fixture.mjs` uses isolated in-memory test data on 8804; screenshots under `output/rail-full-008/CivilNavigator-test-*.png` show 22+300 and 22+958.994. Closing navigation removes marker labels and the extra GPU geometry.
