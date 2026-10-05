# Phase 17 - Scheduler, monitoring et autonomie locale

## Statut

`TERMINEE` - implementation et criteres d'acceptation valides.

## Objectif

Executer durablement des taches ponctuelles, recurrentes ou declenchees par evenement, tout en restant en `EXECUTE_SAFE` par defaut et sans dupliquer une occurrence apres veille, panne ou redemarrage Windows.

## Dependances obligatoires

- Policy Engine et approbations exactes de phase 07.
- Queue, leases, idempotence et reprise de phase 11.
- Supervisor de phase 13 et commandes Telegram de phase 14.
- Memoire locale et invalidation de phase 16.

## Principes non negociables

- Une occurrence possede une identite durable unique.
- La politique est reevaluee au moment d'execution, jamais seulement a la creation.
- Une ancienne approbation ne peut pas autoriser une nouvelle occurrence critique.
- `EXECUTE_SAFE` n'execute automatiquement que les actions LOW explicitement autorisees.
- Aucun redemarrage automatique d'un service sensible sans approbation adaptee.

## Lots de realisation

### 17.1 - Schema et contrats de planification

- Creer la migration `0009_scheduler_monitoring` avec rollback.
- Etendre `scheduled_tasks` et ajouter `schedule_occurrences`, `monitor_definitions`, `monitor_samples`, `incidents` et `incident_events`.
- Supporter `ONE_SHOT`, `INTERVAL`, `CRON` et `LOCAL_EVENT`.
- Stocker fuseau horaire IANA, prochaine execution, fenetre horaire, rattrapage, quotas et statut.
- Ajouter contraintes d'unicite sur `(schedule_id, occurrence_key)` et leases de worker.

### 17.2 - Calcul temporel

- Implementer un calculateur deterministe de prochaine occurrence.
- Gerer heure locale Africa/Douala, UTC, changements de fuseau et horloge systeme reculee.
- Definir politiques de rattrapage `SKIP`, `LATEST_ONLY` et `BOUNDED`.
- Refuser les cron trop frequents ou ambigus selon les limites configurees.
- Ne jamais utiliser une boucle en memoire comme source de verite.

### 17.3 - Worker durable

- Reclamer les occurrences avec transaction et `FOR UPDATE SKIP LOCKED`.
- Utiliser lease, heartbeat, tentatives bornees et idempotency key.
- Reprendre une occurrence interrompue sans rejouer une action dont le resultat est inconnu.
- Respecter l'ordre de soumission utilisateur pour les missions produites au meme instant.
- Appliquer limites globales et par projet pour eviter les conflits d'ecriture.

### 17.4 - Niveaux d'autonomie

- Implementer `OBSERVE`, `ASSIST`, `EXECUTE_SAFE` et `AUTONOMOUS`.
- Garder `EXECUTE_SAFE` comme valeur d'installation et de restauration.
- `OBSERVE` collecte uniquement ; `ASSIST` propose ; `EXECUTE_SAFE` execute LOW autorise ; `AUTONOMOUS` reste borne par la politique et les approbations fortes.
- Toute elevation de niveau exige PIN, apercu exact et audit.
- Permettre une pause globale immediate qui annule les signaux actifs et empeche de nouvelles reclamations.

### 17.5 - Monitoring

- Ajouter moniteurs HTTP locaux/distants explicitement autorises, processus Windows, port TCP et etat de service.
- Stocker latence, code, disponibilite et erreur sanitisee, jamais credential ou corps sensible.
- Implementer seuil de declenchement, fenetre glissante, hysteresis et anti-flapping.
- Creer un incident seulement apres le nombre configure d'echecs consecutifs.
- Clore ou rouvrir un incident avec transitions auditees.

### 17.6 - Reponse aux incidents

- Proposer `INVESTIGATE`, `RESTART` et `IGNORE` depuis Telegram.
- Associer chaque bouton a l'incident, l'actionHash, une expiration et un usage unique.
- Faire passer toute investigation ou correction par le Supervisor et le Policy Engine.
- Exiger une approbation forte pour les services sensibles, la production ou une action reseau.
- Appliquer cooldown et nombre maximal de redemarrages.

### 17.7 - Quotas et notifications

- Configurer concurrence globale, concurrence par projet, budget journalier de missions et budget de notifications.
- Regrouper les alertes identiques dans une fenetre sans masquer un nouvel incident ou une aggravation.
- Utiliser SILENT, NORMAL et VERBOSE de phase 14 ; les alertes SECURITY restent prioritaires.
- Exposer la prochaine occurrence, le dernier resultat et le motif de blocage.

### 17.8 - Administration et reprise Windows

- Ajouter commandes Telegram de creation, liste, pause, reprise, execution immediate et suppression.
- Restaurer les workers apres redemarrage de l'application et du PC.
- Detecter les occurrences en retard et appliquer la politique de rattrapage.
- Fournir une vue diagnostique des leases, files, quotas et incidents.

## Tests obligatoires

- Horloge injectable et tests de one-shot, intervalle, cron, fenetres et rattrapage.
- Simulation de deux workers concurrents prouvant l'absence de double reclamation.
- Redemarrage PostgreSQL et reprise d'occurrence sans doublon.
- Test d'expiration d'approbation entre creation et execution.
- Matrice des quatre niveaux d'autonomie et de tous les risques.
- Tests anti-flapping, regroupement d'alertes, escalation et nouvel incident distinct.
- Test de pause globale pendant une action et absence de nouvelle reclamation.
- Test de quotas et d'ordre FIFO utilisateur.
- Test PostgreSQL reel des migrations et `pnpm verify` complet.

## Criteres d'acceptation

- Un redemarrage du PC ne duplique pas une occurrence.
- Une autorisation ancienne ne couvre jamais une nouvelle occurrence critique.
- `EXECUTE_SAFE` n'execute que des actions LOW explicitement permises.
- Les alertes repetitives sont regroupees sans masquer un nouvel incident.
- Les actions en retard suivent une politique de rattrapage explicite et auditee.
- Pause globale, quotas et limites de concurrence sont effectifs.

## Definition de termine

- Migrations, scheduler, workers, moniteurs, incidents et commandes Telegram livres.
- Scenarios de panne, veille et concurrence valides avec une horloge deterministe puis PostgreSQL reel.
- Documentation des niveaux d'autonomie et runbook incident ajoutes.
- Aucun critere ouvert ; `pnpm verify` vert.

## Exclusions

- Pas de worker VPS 24/7.
- Pas de redemarrage autonome de production.
- Pas de contournement des politiques Windows ou reseau.

## Compte rendu

Statut : `TERMINEE`.

- Migration `0009_scheduler_monitoring` livree avec rollback et conversion descendante
  des types historiques. `scheduled_tasks` est etendue et les tables
  `scheduler_control`, `schedule_occurrences`, `monitor_definitions`, `monitor_samples`,
  `incidents` et `incident_events` sont ajoutees avec contraintes, index et leases.
- Package `@arcc/scheduler` livre avec horloge injectable, one-shot, intervalles, cron a
  cinq champs, evenements locaux, fuseaux IANA, fenetres horaires et rattrapage `SKIP`,
  `LATEST_ONLY` ou `BOUNDED`. Les definitions ambiguës ou plus frequentes que quinze
  minutes sont refusees.
- Chaque occurrence possede une cle durable `(schedule_id, occurrence_key)` et une cle
  d'idempotence globale. Le repository reclame en FIFO avec
  `FOR UPDATE SKIP LOCKED`, applique concurrence globale/projet et budget journalier,
  puis renouvelle les leases par heartbeat.
- Le runtime repersiste la prochaine echeance, restaure les workers apres redemarrage et
  materialise le rattrapage depuis PostgreSQL. Une action interrompue dont le resultat est
  incertain passe en `UNKNOWN` et n'est jamais rejouee automatiquement.
- Le Policy Engine est reexecute juste avant chaque occurrence. La matrice `OBSERVE`,
  `ASSIST`, `EXECUTE_SAFE`, `AUTONOMOUS` est testee pour LOW, MEDIUM, HIGH et CRITICAL.
  Une occurrence critique exige un nouvel `actionHash` et une approbation fraiche.
- `EXECUTE_SAFE` reste la valeur par defaut et de restauration. Le passage a
  `AUTONOMOUS` exige PIN, apercu exact, jeton a usage unique et audit. La pause globale
  incremente une generation, interdit les reclamations, bloque une execution non encore
  lancee et annule les signaux actifs.
- Sondes HTTP autorisees, processus Windows, port TCP et service Windows livrees par
  ports controles. Les credentials, en-tetes et corps sensibles sont refuses; seules
  disponibilite, latence, code de statut et erreur sanitisee sont conserves.
- Seuils d'echecs, fenetre glissante, hysteresis, anti-flapping, ouverture, mise a jour,
  resolution et reouverture d'incident sont livres et audites. Les alertes identiques
  sont groupees, sans masquer aggravation, nouvel incident ni priorite `SECURITY`.
- Reponses Telegram `INVESTIGATE`, `RESTART`, `IGNORE` signees, expirees et a usage unique
  livrees. Investigation et correction passent par Supervisor et Policy Engine; les
  services sensibles, la production et les actions reseau exigent une approbation forte,
  avec cooldown et limite de redemarrage.
- Commandes Telegram de creation, liste, pause, reprise, execution immediate,
  suppression, moniteurs, incidents, autonomie et diagnostic ajoutees. Le diagnostic
  expose pause, autonomie, files, leases incertains et incidents ouverts.
- ADR et runbook livres dans `docs/adr/0007-durable-scheduler-and-incident-state.md` et
  `docs/operations/scheduler-monitoring.md`.

Validation finale :

- `pnpm verify` vert : format, lint, frontieres d'architecture, types, 439 tests et build.
- Package Scheduler : 36 tests couvrant calcul temporel, rattrapage, matrice d'autonomie,
  pause, reprise, absence de rejeu, sondes, hysteresis, alertes, incidents et commandes.
- Base de donnees : 46 tests unitaires, dont reclamation FIFO, quotas, diagnostic et
  reprise `UNKNOWN`.
- `pnpm test:database` vert sur PostgreSQL ephemere : 44 tables, migration montante,
  reclamation exclusive, unicite apres panne, incident, redemarrage PostgreSQL, migration
  descendante, reapplication et nettoyage du conteneur/volume.

Aucun critere d'acceptation de la phase 17 ne reste ouvert. Le worker VPS 24/7 et le
redemarrage autonome de production restent explicitement exclus.
