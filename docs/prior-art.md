# Prior art

Orrery borrows patterns, not code, from the projects below. Where a project is a dependency it is
listed as such, and its license is on the allowlist (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
ISC, 0BSD). Every influence is also credited in `NOTICE`.

| Project                                                                                         | License      | What was taken                                                                                                     | Status                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Netflix Vizceral](https://github.com/Netflix/vizceral)                                         | Apache-2.0   | The idea of drilling from a global view to a regional view to a service, and animated traffic particles.           | Pattern only; no code copied. The project is not maintained, so it is reference only.                                               |
| [OpenLineage](https://openlineage.io/) and [Marquez](https://marquezproject.ai/)                | Apache-2.0   | The run-event model that shapes `PlatformEvent`: typed events with timestamps and the ids of the objects involved. | The optional OpenLineage adapter reads this event model; its public sample events are Marquez's (Apache-2.0, credited in `NOTICE`). |
| [three.js](https://threejs.org/)                                                                | MIT          | The 3D renderer for the system view.                                                                               | Runtime dependency of `@orrery/render`.                                                                                             |
| [vasturiano 3d-force-graph](https://github.com/vasturiano/3d-force-graph)                       | MIT          | Candidate for a lineage drill-down inside a spoke, with directional particles and DAG mode.                        | Not used. No dependency has been added.                                                                                             |
| [Unity Catalog lineage](https://docs.databricks.com/data-governance/unity-catalog/data-lineage) | Product docs | The 2D lineage view to link out to from detail cards.                                                              | Not implemented. The Databricks adapter reads lineage system tables, but the UI has no link-out yet.                                |

## Notes

- **Patterns only.** Reading a project's ideas and documentation is not copying it. No source from
  Vizceral, OpenLineage, or Marquez is in this repository. If a future change does copy code, the
  license must be on the allowlist, and `NOTICE` and this file must say so.
- **The Orloj view** is modeled on the medieval astronomical clocks of central Europe. Its layout,
  motion, and parts are original work, ported from the project's own prototypes in `reference/`.
- **Databricks and Unity Catalog** are named only to describe compatibility. Orrery is not
  affiliated with or endorsed by Databricks, Inc. See `docs/databricks.md` for the data it reads.
- **Dependencies** are checked against the license allowlist in CI (`pnpm check:licenses`).
  Two development-only exceptions, `minimatch` (BlueOak-1.0.0) and the axe accessibility tooling
  (MPL-2.0), are recorded in `docs/decisions.md` (decisions 3 and 4) and never ship.
