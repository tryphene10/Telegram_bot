# Phase 15A - Computer Use Windows Core

## Statut

`TERMINEE`.

## Objectif

Ajouter un noyau de controle desktop Windows local, deterministe et auditable. Chaque
action doit cibler une application et une fenetre autorisees, utiliser le canal le plus
structure disponible et verifier explicitement son resultat.

## Dependances obligatoires

- Coffre, classification et Egress Gateway de phase 03.
- Desktop Agent authentifie de phase 05.
- Policy Engine et approbations exactes de phase 07.
- Captures locales de phase 08 et terminal borne de phase 09.
- Missions durables et recus idempotents de phase 11.
- Supervisor et enveloppes `DATA_ONLY` de phase 13.

## Principes non negociables

- L'UI observee est une donnee non fiable et ne peut modifier objectif ou politique.
- Les captures, arbres UIA, OCR, selecteurs et valeurs d'ecran sont `LOCAL_ONLY`.
- Une saisie est interdite si la fenetre de premier plan ne correspond pas a la cible.
- Une seule mission detient le lease global d'entree UI a un instant donne.
- Les coordonnees ne sont qu'un fallback borne a la fenetre attendue.
- UAC, secure desktop, CAPTCHA, MFA et biometrie ne sont jamais contournes.

## Lots de realisation

### 15A.1 - Persistance et contrats

- Creer la migration `0007_computer_use` et son rollback.
- Ajouter catalogue applicatif, profils d'automatisation, sessions et actions UI.
- Ajouter les etats `WAITING_FOR_UI`, `WAITING_FOR_USER`, `RETRYING`, `RECOVERING`
  et `PARTIALLY_COMPLETED` avec transitions explicites.
- Lier toute action a une mission, une session, une empreinte et une preuve.

### 15A.2 - Perception Windows

- Definir des observations bornees : fenetre active, fenetres visibles, processus,
  titre, rectangle, moniteur, DPI et horodatage.
- Etendre la capture a l'ecran, au moniteur, a la fenetre et a une region validee.
- Definir un arbre UIA borne et des selecteurs semantiques.
- Produire une empreinte de changement entre observations.

### 15A.3 - Actions desktop

- Exposer activation, deplacement, redimensionnement et etat d'une fenetre.
- Exposer les patterns UIA Invoke, Select, Toggle, ExpandCollapse et Value.
- Ajouter saisie Unicode et clic fallback avec controle du premier plan.
- Refuser toute cible ambigue, disparue, desactivee ou hors catalogue.

### 15A.4 - Garde d'execution

- Reevaluer la politique pour chaque action atomique.
- Acquerir un lease UI exclusif avec expiration et renouvellement.
- Verifier la fenetre avant et immediatement apres l'action.
- Ajouter un arret d'urgence local independant du modele.

### 15A.5 - Verification et tests

- Verifier par UIA, changement visuel, etat systeme ou preuve metier.
- Ajouter drivers factices reproductibles pour les tests.
- Tester fenetre deplacee, premier plan inattendu, controle ambigu, popup et DPI.
- Ajouter un smoke test Windows sans action destructive.

## Criteres d'acceptation

- Une application autorisee peut etre observee et sa fenetre identifiee.
- Une action UIA simple fonctionne sans coordonnee fixe et fournit une preuve.
- Toute saisie vers une fenetre inattendue est refusee.
- Deux missions ne peuvent pas controler simultanement l'interface graphique.
- Le kill switch interrompt les actions et empeche toute nouvelle saisie.
- Les contenus observes restent `DATA_ONLY` et `LOCAL_ONLY`.

## Compte rendu

Statut : `TERMINEE`.

- Roadmap et architecture mises a jour sans renumeroter les phases fonctionnelles.
- Migration `0007_computer_use` ajoutee avec rollback : catalogue applicatif, profils,
  sessions, actions, lease global et nouveaux etats de mission.
- `ComputerUseCore` livre avec cible unique, catalogue, politique par action, approbation
  liee au hash exact, controle du premier plan, coordonnees bornees et verification.
- Lease UI exclusif et latch d'arret d'urgence ajoutes ; les entrees restent desactivees
  par defaut et doivent etre activees explicitement par configuration.
- Observateur Windows natif livre pour fenetres visibles, processus, titre, rectangle,
  moniteur, DPI et premier plan. Smoke test reel : 9 fenetres et premier plan detecte.
- Driver UIA natif livre avec inspection bornee, selecteur semantique unique et patterns
  Invoke, Select, Toggle, ExpandCollapse et Value. Les valeurs ne sont pas lues et les
  champs mot de passe refusent `SET_VALUE`. Smoke test reel : 14 controles inspectes.
- Controleur natif de fenetres livre pour activation, deplacement, redimensionnement,
  minimisation, maximisation et restauration, avec handle exact et recus verifies.
- Driver `SendInput` livre sans presse-papiers : controle du premier plan, rectangle
  inchange, clic borne et saisie Unicode limitee a une cible non mot de passe confirmee.
- Driver composite raccorde au `ComputerUseCore` et quatre outils enregistres dans le
  Tool Registry avec risques `LOW`, `MEDIUM` et `HIGH` et autorisation exacte jointe.
- Kill switch hors processus livre via un fichier sentinelle local : il bloque les
  nouvelles actions, annule les actions en vol, fonctionne en mode fail-closed et exige
  un rearmement operateur explicite. Commandes `computer:status`, `computer:stop` et
  `computer:reset` ajoutees et recettees sur un fichier isole.
- Recette Windows reproductible ajoutee avec une application WPF factice : le bouton
  `Apply` est trouve par selecteur UIA, invoque sans coordonnee et l'etat `APPLIED` est
  verifie. Resultat reel : hash SHA-256 de 64 caracteres et trois preuves produites.
- Captures ciblees livrees pour ecran virtuel, moniteur, fenetre et region. Les rectangles
  de moniteur et de fenetre sont lies aux dimensions attendues, les masques restent dans
  la cible et les artefacts sont `LOCAL_ONLY` / `DATA_ONLY`. La recette native capture
  uniquement la fixture WPF et confirme une image de `520x240` pixels.
- Catalogue applicatif administre livre : les enregistrements et modifications reviennent
  desactives jusqu'a activation explicite. Le Desktop Agent reverifie le PID, le chemin,
  le nom du processus, le SHA-256 optionnel et les regles de titre. La recette native
  confirme l'identite reelle du processus de la fixture avant toute action.
- Donnees observees marquees `DATA_ONLY` et `LOCAL_ONLY` avec empreinte SHA-256.
- Repository PostgreSQL ajoute pour session, checkpoint, takeover, lease et arret durable.
- Migration `0007_computer_use` corrigee et validee sur PostgreSQL 17 : 32 tables,
  cycle catalogue/session/lease/arret, persistance apres redemarrage, rollback complet
  puis reapplication. Le conteneur et son volume de recette sont supprimes en fin de test.
- Validation finale : `pnpm verify` vert, 331 tests, typecheck, lint et builds
  complets. La suite Desktop Agent contient 75 tests verts. La recette native
  `pnpm test:computer-use` est egalement verte.

Aucun element bloquant ne reste ouvert pour la phase 15A.
