# Phase 13 - Supervisor et agents specialises

## Objectif

Comprendre un objectif, planifier, deleguer, executer et verifier dans les politiques existantes.

## Dependances

Phases 06 a 12 terminees et projet bac a sable disponible.

## Travaux

- Implementer le Supervisor : intention, resolution projet/machine, plan, delegation, controle et synthese.
- Respecter le modele selectionne pour la mission et les surcharges par agent ; demander une decision si un agent exige un autre modele.
- Ajouter Developer, Testing, File, Security Reviewer et DevOps Agent avec outils minimaux.
- Donner a chaque run un budget, un nombre maximal d'iterations et des criteres de sortie.
- Separer proposition LLM, decision de politique et execution deterministe.
- Defendre contre les instructions malveillantes contenues dans README, PDF, page Web ou sortie d'outil.
- Implementer verification par tests, build, lint, typecheck ou controle adapte au manifeste.

## Criteres d'acceptation

- Le LLM ne peut ni inventer un outil ni modifier une decision de politique.
- Le Supervisor ne remplace jamais silencieusement GPT, Claude, DeepSeek, Kimi ou le modele local choisi.
- Une mission de correction sur projet de test suit plan, modification, verification, diff et rapport.
- Les boucles s'arretent au budget et produisent un diagnostic exploitable.
- Le rapport distingue faits verifies, hypotheses, actions et risques restants.

## Exclusions

Research cloud sur contenu projet interdit ; navigateur traite en phase 15.

## Compte rendu

Statut : `TERMINEE`.

- Supervisor compatible avec le moteur de missions durable : resolution cible, plan borne, delegation, controle et synthese.
- Cinq agents specialises avec listes d'outils minimales et strictes : Developer, Testing, File, Security Reviewer et DevOps.
- Separation imposee entre proposition non fiable du modele, decision de politique et execution d'outil.
- Selection exacte du modele par mission/agent ; tout changement attend une decision explicite et aucune substitution n'est acceptee.
- Enveloppes `DATA_ONLY` avec empreinte pour README, PDF, pages Web et sorties d'outil ; les permissions contenues dans ces donnees sont sans effet.
- Budgets d'appels IA, d'outils, d'iterations et de temps, persistables via la migration `0006_supervisor_agents`.
- Verification declarative TEST/BUILD/LINT/TYPECHECK et rapport distinguant faits verifies, hypotheses, actions, preuves et risques.
- Scenario de correction complet valide : plan, ecriture, inspection du diff, tests, build, lint, typecheck et rapport.
- Validation finale au moment de la phase : PostgreSQL reel avec rollback/reapplication, frontieres d'architecture, 252 tests et build complet.
