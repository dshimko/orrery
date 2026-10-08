# Private configuration

Everything in this directory except this README is git-ignored. Forks keep their real
`orrery.config.yaml` here and point `ORRERY_CONFIG` at it, or bake it into a package with
`ORRERY_PACKAGE_CONFIG=config/private/orrery.config.yaml pnpm package`.

A `theme.yaml` here is merged over the config's `visuals` at startup (or set `ORRERY_THEME` to
another file). It has one top-level key, `visuals`, with any part of the visuals block:

```yaml
visuals:
  lighting:
    ambientIntensity: 0.6
```

Objects merge and arrays or scalars replace; the result is validated like the main config. Your
logo goes in `public/private/` (`logo.svg`, `logo.png`, or `logo.webp`, at most 512 KB). See
`docs/forking.md`.
