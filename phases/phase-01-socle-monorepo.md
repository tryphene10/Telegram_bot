# Phase 01 - Socle monorepo Windows

## Objectif

Creer un depot reproductible qui impose les frontieres de modules des le depart.

## Dependances

Phase 00 terminee et ADR structurants valides.

## Travaux

- Initialiser Git et le monorepo TypeScript avec `apps/api`, `apps/telegram-bot`, `apps/desktop-agent`, `apps/web-dashboard`.
- Creer les packages `protocol`, `database`, `security`, `policies`, `tools`, `ai`, `agents` et `shared`.
- Configurer formatage, lint, typecheck, tests, build, variables d'environnement validees et journalisation structuree.
- Ajouter une CI locale/scriptable, des conventions de commits et des gabarits d'ADR.
- Ajouter des commandes PowerShell documentees pour installation et verification sur Windows.
- Interdire les dependances circulaires entre interface, orchestration, politiques et execution.

## Criteres d'acceptation

- Installation, lint, typecheck, tests et build passent depuis un clone propre.
- Chaque application demarre avec un endpoint ou signal de sante minimal.
- Aucun secret ni fichier `.env` n'est versionne.
- Les regles d'import empechent l'API ou Telegram d'executer directement un outil local.

## Exclusions

Pas encore de logique metier, d'IA ou d'execution de commandes.

## Compte rendu

Statut : `TERMINEE`.

Terminee le 13 septembre 2026.

- Depot Git initialise et monorepo pnpm cree avec quatre applications et huit packages.
- Node 22, TypeScript strict, ESLint, Prettier et Vitest configures avec lockfile.
- Validation d'environnement fail-closed sur l'adresse loopback, le port et le niveau de log.
- Controle automatise des frontieres : interfaces sans Tools, API sans child process, SDK IA confines.
- Artefacts compiles demarres ; endpoint API `/health` verifie sur `127.0.0.1`.
- `pnpm verify` passe apres format, lint, typecheck, tests et build.
