# Phase 10 - Git et Docker controles

## Objectif

Permettre les workflows de developpement courants avec separation nette des actions sensibles.

## Dependances

Phases 06 a 09 terminees ; depot et environnement Docker de test non sensibles disponibles.

## Travaux

- Implementer `status`, `diff`, `log`, branches, worktree, add et commit via arguments structures.
- Detecter et proteger les changements utilisateur preexistants.
- Exiger diff et tests prevus avant commit ; lier l'approbation au contenu exact.
- Traiter pull, push, reset destructif et changement de branche selon risques distincts.
- Ajouter Docker `ps`, logs, inspect, build et Compose avec projets/environnements bornes.
- Exiger approbation forte pour push, publication d'image et toute cible de production.

## Criteres d'acceptation

- Aucun changement utilisateur n'est ecrase ou inclus silencieusement.
- Commit, push et deploiement demandent des autorisations separees.
- Un diff modifie apres validation invalide le commit approuve.
- Les commandes Docker ne peuvent viser une ressource hors perimetre configure.

## Exclusions

Pas de deploiement production automatique.

## Compte rendu

Statut : `TERMINEE`.

- Git est expose par operations structurees : status, diff, log, branches, worktrees, stage, commit, switch, pull, push et reset. Aucun argument brut ni shell n'est accessible.
- Un instantane hashé des changements anterieurs a la mission protege les modifications utilisateur ; leur inclusion doit etre nominative et explicite.
- Le commit exige au moins une preuve de test reussie et recalcule le hash du diff indexe juste avant l'execution. Toute modification invalide l'action approuvee.
- Commit, pull, push, reset et changement de branche/worktree possedent des outils, risques, categories de politique et hashes d'action distincts. Le commit exige une validation forte.
- Docker et Compose sont bornes au nom de projet, aux fichiers Compose autorises, a une liste de services et aux prefixes d'images configures.
- `ps`, logs, inspect, build, controle Compose et publication sont separes. L'inspection resout d'abord les identifiants via le service Compose autorise.
- Publication et acces reseau demandent une validation forte ; toute operation Docker en production refuse defensivement une autorisation non forte. Aucun deploiement production automatique n'est implemente.
- Validation : verification complete du monorepo reussie ; 61 tests outils, 22 tests de politique et 37 tests Desktop Agent, dont une lecture reelle du depot via `git.exe` sans shell. Docker est valide par adaptateur simule borne, sans toucher au daemon local.
