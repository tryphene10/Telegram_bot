# Phase 11 - Missions, files et reprise

## Objectif

Orchestrer durablement des missions longues sans duplication ni perte d'etat.

## Dependances

Phases 02, 05, 07, 08, 09 et 10 terminees.

## Travaux

- Implementer creation, normalisation d'objectif, contexte, priorite et criteres de succes.
- Gerer plan, etapes, dependances, tentatives, limites de boucle et Definition of Done.
- Implementer les files missions, outils, approbations, notifications et taches planifiees.
- Ajouter pause, reprise, stop, echec, blocage et annulation coherents.
- Implementer idempotence, project lock et reprise apres redemarrage ou reconnexion.
- Calculer une timeline complete et un rapport final preliminaire.

## Criteres d'acceptation

- Tous les etats et transitions du cahier des charges sont testes.
- Redemarrage de chaque processus reprend sans doubler une action.
- Une mission bloquee indique cause, action attendue et possibilite de reprise.
- Une mission ne peut etre `COMPLETED` sans verification objective disponible.

## Exclusions

La planification est encore deterministe/factice, sans LLM reel.

## Compte rendu

Statut : `TERMINEE`.

- Les objectifs, contextes, criteres de succes et Definition of Done sont normalises et lies a une cle d'idempotence ; toute reutilisation avec un autre contenu est refusee.
- Le plan deterministe est un DAG valide avec dependances, criteres de sortie, tentatives et boucles bornees.
- L'ordre de traitement suit strictement la sequence de soumission. Les missions ne peuvent pas se depasser silencieusement.
- La migration 0004 ajoute leases de mission et projet, reçus d'action idempotents, contexte de blocage et reprise, ainsi que les files outils, approbations, notifications et taches planifiees.
- Les reclamations PostgreSQL utilisent une mise a jour atomique et `FOR UPDATE SKIP LOCKED`; les processus actifs renouvellent leur lease par heartbeat.
- Pause et annulation propagent un `AbortSignal` jusqu'a l'outil actif. Reprise, echec, attente d'approbation et blocage suivent la machine d'etats testee exhaustivement.
- Apres redemarrage, un reçu termine est reutilise sans rejouer l'action. Une action au resultat inconnu n'est jamais relancee automatiquement : la mission est `BLOCKED` avec cause et action manuelle attendue.
- `COMPLETED` n'est accessible qu'apres verification reussie avec au moins une preuve objective. Une timeline sequencee et un rapport final preliminaire sont produits.
- Validation : verification complete du monorepo reussie ; 26 tests base de donnees, 12 tests moteur de missions et test PostgreSQL/Docker reel avec 26 tables, redemarrage persistant, down puis up integral.
