# ADR 0002 - PostgreSQL et Redis/BullMQ locaux

- Statut : accepte
- Date : 2026-09-13

## Decision

PostgreSQL porte toutes les donnees durables et l'audit. Redis/BullMQ gere files, locks et signalisation asynchrone. Les deux sont lances par Docker Compose et lies a localhost.

## Raisons

Cette separation correspond au cahier des charges, facilite la reprise et prepare un futur deploiement VPS. Redis ne constitue jamais l'unique copie d'un etat metier necessaire.

## Consequences

Docker Desktop devient une dependance d'exploitation du premier cycle. Des health checks, volumes nommes, sauvegardes et migrations sont obligatoires.
