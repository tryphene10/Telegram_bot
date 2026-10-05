# ADR 0007 - Scheduler durable et incidents locaux

## Statut

Accepte.

## Decision

PostgreSQL est la seule source de verite du scheduler. Une boucle Node.js ne fait que
sonder les echeances, materialiser des occurrences et reclamer du travail. Chaque
occurrence est unique par `(schedule_id, occurrence_key)` et possede aussi une cle
d'idempotence globale.

Les occurrences `RUNNING` dont le lease expire deviennent `UNKNOWN`. Elles ne sont pas
remises automatiquement en file, car le resultat externe peut exister sans avoir ete
persiste. Une intervention ou une reconciliation explicite est alors necessaire.

La politique est recalculee pour chaque occurrence juste avant execution. Les
approbations portent sur le nouvel `actionHash`; une approbation d'une occurrence
precedente ne peut donc pas etre reutilisee. Le niveau restaure au demarrage reste
`EXECUTE_SAFE`.

Le monitoring persiste uniquement disponibilite, latence, code de statut et code
d'erreur sanitise. Les corps HTTP, en-tetes et credentials sont interdits. Les incidents
sont ouverts apres un seuil d'echecs consecutifs et clos apres un seuil distinct de
succes afin d'eviter le flapping.

## Consequences

- Un redemarrage Windows ne perd ni echeance ni incident.
- La reprise privilegie l'absence de double effet a la disponibilite automatique.
- `FOR UPDATE SKIP LOCKED`, les limites globales/projet et l'ordre
  `due_at, submission_sequence` permettent plusieurs workers sans double reclamation.
- Les sondes HTTP passent par un port autorise; le package Scheduler n'effectue aucun
  acces reseau direct.
