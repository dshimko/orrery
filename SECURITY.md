# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button
(Security tab → Advisories) rather than in a public issue. Include steps to reproduce and the
affected version or commit. We aim to acknowledge reports within five working days.

## Design commitments

- **Read-only.** Orrery only issues `SELECT` statements against metadata, system, and
  monitoring tables. It never writes to the data platform.
- **Server-side credentials.** Adapters run only on the server. The browser never receives a
  platform token.
- **No secrets in config.** Secret fields accept only `${env:NAME}` references, and a
  pre-commit hook plus CI run gitleaks.
- **Query allowlist.** The server runs only the `.sql` files shipped with an adapter or
  registered by a fork. It never runs free-form SQL from the browser.
- **No telemetry** by default. All assets are bundled, and the Content Security Policy allows
  no third-party script hosts.
