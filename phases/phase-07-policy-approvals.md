# Phase 07 - Policy Engine et approbations

## Objectif

Placer une decision deterministe entre toute intention et toute execution.

## Dependances

Phases 02 a 06 terminees ; matrice de risques initiale validee.

## Travaux

- Implementer `ALLOW`, `DENY`, `REQUIRE_APPROVAL`, `REQUIRE_STRONG_APPROVAL`.
- Evaluer utilisateur, projet, machine, outil, parametres, environnement, classification et contexte.
- Creer une matrice LOW/MEDIUM/HIGH/CRITICAL configurable sans donner le dernier mot au LLM.
- Lier chaque approbation au hash canonique de l'action, aux parametres, a l'identite et a une expiration.
- Ajouter approbation Telegram simple ou PIN, refus, annulation et reprise de mission.
- Produire une explication lisible de chaque decision et un evenement d'audit.

## Criteres d'acceptation

- Modifier un parametre invalide automatiquement l'approbation.
- Push, production, publication, paiement et suppression irreversible exigent toujours une validation forte.
- Perte de connexion ou erreur d'evaluation donne `DENY` ou attente, jamais `ALLOW`.
- Les tests de table couvrent chaque outil et chaque niveau de risque.

## Exclusions

Pas encore d'interface d'outil reelle autre qu'un simulateur.

## Compte rendu

Statut : `TERMINEE`.

- Moteur deterministe couvrant contexte utilisateur, projet, machine, outil, parametres, environnement et classification.
- Matrice LOW/MEDIUM/HIGH/CRITICAL configurable, liste d'autorisation/refus et comportement fail-closed.
- Approbations simples Telegram et fortes par PIN, liees au hash canonique, a l'identite et a l'expiration.
- Autorisations a usage unique avec refus, annulation, expiration, reprise de mission et audit structurel sans parametres sensibles.
- Migration `0003_approval_consumption` validee en integration PostgreSQL avec montee, descente et reapplication.
- Validation : verification complete du monorepo reussie ; 18 tests de politiques et d'approbations, plus 69 tests des autres composants.
- Note : la couverture par outil porte sur le simulateur et les categories de risque conformement aux exclusions ; les outils reels sont ajoutes et testes en phase 08.
