# Private configuration

Everything in this directory except this README is git-ignored. Forks keep their real
`orrery.config.yaml` here and point `ORRERY_CONFIG` at it, or bake it into a package with
`ORRERY_PACKAGE_CONFIG=config/private/orrery.config.yaml pnpm package`. Theme overrides through
a `theme.yaml` are not supported yet (see `docs/forking.md`).
