# Train FPS simulation

`infra_simulate_train` is a Shared Tool Registry command, available to MCP, HTTP tools and the in-app assistant. Example:

```json
{"alignment":"AL-001","action":"start","speed_kmh":80,"eye_height":2.6,"track_offset":2.25,"look_ahead":12}
```

Actions: `start` (alignment start unless `station` is explicit), `pause`, `resume`, `stop`. Resume preserves calculated progress and accepts a changed speed. Stop exits FPS and restores camera controls/projection; the civil navigator opens at the route start. `infra_query_navigation` reports calculated playback progress. Existing AI approval, permissions, audit and undo apply. No alignment/corridor geometry changes.

The left sidebar has “Tren FPS simülasyonu”. Defaults: 80 km/h, eye height 2.6 m vertically above rail, right track offset +2.25 m. Left track is -2.25 m. Track offset must match the actual corridor; this is a camera setting, not track generation.

The existing canonical evaluator supplies adaptive route samples (1 mm chord tolerance, at most 2 m step). Speed is measured along their 3D arc length, not horizontal chainage or viewer coordinates. Source elevations and engineering stations remain separate from rebased viewer positions. The camera uses the existing ThatOpen World, its native FirstPerson mode, and perspective projection, looking ahead along the 3D route. No separate viewer/render loop, physics engine, vehicle body, cant, suspension or terrain is introduced.

Playback uses a shared start timestamp and distance anchor saved in the existing optional `CivilNavigationSet` view state. Every open client follows the same approved timeline. Reload/backgrounding does not freeze shared time; pausing is an explicit tool command. No events are written per frame. At the end, the camera freezes at the exact endpoint, HUD shows completed, and the playback tick is removed. Pause also removes the tick; resume installs one new listener. Exiting, changing project or disposing removes the HUD/tick and restores camera controls.

Verification: `apps/web-server/test/train-simulation.test.ts` covers 3D km/h, pause, endpoint clamp, pitch sign, eye height/right offset, tool lifecycle, geometry cache stability and replay. Existing civil navigation and assistant tests also pass. Isolated browser fixture on 8804 verifies actual train perspective, speed change, pause/resume and completion. Screenshots: `output/rail-full-008/Train-FPS-*.png`.
