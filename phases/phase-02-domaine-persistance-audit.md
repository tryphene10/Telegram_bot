# Phase 02 - Domaine, persistance et audit

## Objectif

Implementer la source de verite locale et les transitions d'etat auditables.

## Dependances

Phase 01 terminee ; choix de persistance confirme par l'ADR de phase 00.

## Travaux

- Modeliser utilisateur, compte Telegram, machine, projet, mission, etape, agent, outil, execution, approbation, fichier, artefact, memoire, secret-metadata, notification et usage modele.
- Installer PostgreSQL local et migrations versionnees ; justifier tout service supplementaire.
- Implementer les machines d'etats de mission, execution et approbation avec transitions validees.
- Creer un Audit Log append-only avec parametres sanitises, correlation et horodatage UTC.
- Definir politiques de retention et purge pour logs, captures et fichiers temporaires.
- Ajouter repositories/services testables sans dependance a Telegram.

## Criteres d'acceptation

- Migrations aller/retour testees sur une base vierge.
- Transitions illegales refusees et auditees.
- Redemarrer l'API ne perd aucune mission persistante.
- Les donnees sensibles d'exemple n'apparaissent pas dans l'audit.

## Exclusions

Pas d'execution locale ni d'appel IA.

## Compte rendu

Statut : `TERMINEE`.

- Migration PostgreSQL versionnee couvrant 24 tables de domaine, contraintes d'etat, index de cles et index partiels.
- Machines d'etat deterministes pour missions, approbations et executions d'outil.
- Transitions refusees journalisees avec donnees structurelles sanitisees.
- Repository de mission sans etat local, avec controle de concurrence par statut et version.
- Audit append-only avec chaine SHA-256 serialisee par verrou transactionnel.
- Retention par defaut : logs 30 jours, captures 7 jours, temporaires 24 heures.
- Test Docker isole valide : aller, refus de falsification, persistance apres redemarrage, retour et reappplication.
- Validation finale : 24 tables detectees et aucun secret canari brut dans l'audit.
