# Phase 15B - Autonomie et co-pilotage Windows

## Statut

`TERMINEE` - implementation et criteres d'acceptation valides.

## Objectif

Construire une boucle Observe, Plan, Act, Verify au-dessus du noyau Computer Use,
avec fallback borne, dry run, reprise humaine et preuves de fin de mission.

## Dependances obligatoires

- Phase 15A terminee avec lease UI, kill switch, perception et actions atomiques.
- Moteur de missions durable de phase 11.
- AI Gateway sans substitution silencieuse de modele de phase 12.
- Supervisor et verification de phase 13.
- Experience Telegram et artefacts de phase 14.

## Principes non negociables

- Ordre par defaut : connecteur, CLI, UIA, navigateur, vision et entree brute.
- Un fallback ne peut jamais reduire le niveau d'approbation requis.
- Le modele choisi reste exact ; tout changement exige un accord explicite.
- Une mission n'est terminee qu'apres verification objective.
- Teach Mode et apprentissage permanent restent exclus jusqu'a la phase 16.

## Lots de realisation

### 15B.1 - Plan et dry run

- Classer objectif, contraintes, livrables, hypotheses et informations manquantes.
- Produire un plan machine-readable editable avant execution.
- Calculer risque, canaux, fichiers, applications et approbations attendues.
- Invalider le dry run apres changement de contexte ou d'empreinte.

### 15B.2 - Boucle adaptative

- Observer avant chaque action et comparer a l'etat attendu.
- Executer une action atomique puis verifier avant de continuer.
- Classer les erreurs et appliquer retry avec backoff borne.
- Essayer un autre canal uniquement s'il est autorise et au moins aussi sur.
- Bloquer et expliquer lorsque le niveau de confiance est insuffisant.

### 15B.3 - Reprise humaine et Focus Mode

- Ajouter pause UI, takeover, restitution de controle et checkpoint valide.
- Detecter l'activite utilisateur concurrente et suspendre les entrees.
- Reconstruire l'etat apres intervention humaine avant toute reprise.
- Exposer un indicateur d'automatisation et un kill switch local.

### 15B.4 - Telegram et preuves

- Ajouter `/plan`, `/takeover`, `/continue`, `/retry`, `/proof`, `/queue` et `/dryrun`.
- Lier chaque callback a la mission, l'action, l'etat et l'expiration exacts.
- Produire captures annotees sans secret lorsque la decision est visuelle.
- Rassembler preuves, actions, retries, interventions et risques restants.

### 15B.5 - Resilience et concurrence

- Reprendre une session interrompue depuis son dernier checkpoint valide.
- Ne jamais rejouer automatiquement une action au resultat inconnu.
- Autoriser les travaux non UI en parallele tout en gardant un lease UI global.
- Ajouter budgets d'actions, retries, temps et consommation modele.

## Criteres d'acceptation

- Une mission desktop multi-etapes se termine avec preuves verifiables.
- Un changement d'interface provoque replanification ou blocage, jamais une action aveugle.
- Le takeover suspend immediatement les entrees et la reprise revalide le contexte.
- Le dry run ne produit aucun effet externe et devient caduc apres changement d'etat.
- Un fallback respecte classification, modele choisi, politique et approbations.
- Une perte temporaire de connexion ne perd ni plan, checkpoint ni audit.

## Compte rendu

Statut : `TERMINEE`.

- Plan adaptatif versionne et lie a une empreinte de contexte.
- Plan machine-readable enrichi avec objectif, contraintes, livrables, hypotheses,
  informations manquantes, applications, fichiers et criteres de succes. Creation et
  revision sont validees et chaque version possede une empreinte SHA-256.
- Dry run sans effet avec invalidation explicite du contexte perime ou des informations
  manquantes, canaux tries, risque maximal et approbations attendues.
- Persistance du plan complet dans `missions.plan` ajoutee avec verrouillage optimiste
  par version afin qu'une edition obsolete ne puisse ecraser une revision concurrente.
- Runner deterministe respectant l'ordre connecteur, CLI, UIA, navigateur, vision/input.
- Fallback borne par `maxAttempts`, approbation de strategie et verification obligatoire.
- Retry exponentiel borne, classification des erreurs et budgets d'actions, retries,
  temps mural et consommation modele. Un fallback moins sur est refuse.
- Changement de contexte bloque l'execution et exige une replanification.
- Controleur de takeover et Focus Mode avec checkpoint, detection native de l'activite
  utilisateur, suspension des entrees, revalidation et etat `RECOVERING`.
- Commandes Telegram `/plan`, `/takeover`, `/continue`, `/retry`, `/proof`, `/queue`
  et `/dryrun` ajoutees au parseur.
- Callbacks Telegram a usage unique lies cryptographiquement a l'action, a la mission,
  a la revision d'etat et a l'expiration exacte.
- Etapes `ADAPTIVE_DESKTOP` raccordees au Supervisor et au moteur de missions durable,
  avec chargement du plan exact, routage dedie et checkpoint persiste.
- Captures Windows annotees avec marqueurs bornes, masquage applique avant annotation et
  conservation locale limitee dans le temps.
- Collecteur final de preuves avec etapes verifiees, artefacts annotes, actions, retries,
  interventions, risques restants, actions inconnues et empreinte SHA-256.
- Reprise PostgreSQL apres deconnexion : plan et checkpoint conserves, lease libere et
  action en vol marquee `UNKNOWN`, donc jamais rejouee automatiquement.

Tous les lots 15B.1 a 15B.5 et les criteres d'acceptation sont couverts. Teach Mode et
apprentissage permanent restent volontairement hors perimetre jusqu'a la phase 16.

Validation finale :

- `pnpm verify` vert : format, lint, frontieres d'architecture, types, 357 tests et build.
- Desktop Agent : 89 tests ; base de donnees : 39 tests ; agents : 27 tests ; Telegram :
  46 tests ; outils : 61 tests.
- `pnpm test:adaptive-computer-use` vert : mission multi-etapes, checkpoint, preuve finale
  et invalidation du dry run.
- `pnpm test:computer-use` vert sur Windows : WPF/UIA, saisie, verification, capture
  annotee 520 x 240 et identite du catalogue applicatif.
- `pnpm test:database` vert sur PostgreSQL ephemere : 32 tables, reprise apres coupure,
  action `UNKNOWN`, persistance apres redemarrage, migrations down/up et nettoyage du
  conteneur et du volume.
