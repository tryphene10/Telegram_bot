# AI Remote Command Center

Plateforme personnelle Windows, local-first, permettant de piloter des missions d'agents IA depuis Telegram sans donner au bot un acces direct au terminal.


## Prerequis

- Windows 11
- Node.js 22+
- Corepack
- Docker Desktop avec WSL2
- Git

## Demarrage du socle

```powershell
corepack enable
corepack pnpm install
corepack pnpm verify
```

Les applications de phase 01 exposent uniquement un signal de sante ou de disponibilite. Elles ne disposent encore d'aucune capacite d'execution locale.

## Securite

Le code, les diffs, les logs, les captures et la memoire projet sont `LOCAL_ONLY`. Consultez `docs/security/data-classification.md` avant toute integration externe.

La base de connaissances locale, ses limites et sa purge sont documentees dans
[`docs/operations/local-knowledge.md`](docs/operations/local-knowledge.md).

La planification durable, les niveaux d'autonomie et le runbook incident sont decrits
dans [`docs/operations/scheduler-monitoring.md`](docs/operations/scheduler-monitoring.md).
