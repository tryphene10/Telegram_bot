# Phase 19 - Durcissement, integration et livraison Windows

## Statut

`IMPLEMENTATION_TERMINEE - RECETTE_EXTERNE_EN_ATTENTE` - code, commandes, securite,
tests locaux et paquet Windows finalises le 2 octobre 2026. La promotion `TERMINE` reste
conditionnee par les controles sur l'environnement Windows cible enumeres plus bas.

## Objectif

Livrer un prototype complet, installable, recuperable et suffisamment robuste pour un usage personnel reel sur Windows, avec un parcours Telegram et dashboard entierement raccorde aux services locaux.

## Dependances obligatoires

- Toutes les phases fonctionnelles terminees et documentees.
- Aucun test ignore sans justification acceptee.
- Versions de Node.js, pnpm, PostgreSQL, Redis, Chrome/Edge et runtime IA local figees.

## Principes de sortie

- Installation locale uniquement et permissions minimales.
- Configuration initiale guidee, secrets proteges par DPAPI et aucune cle dans `.env` en production.
- `EXECUTE_SAFE` actif apres installation, restauration ou mise a jour.
- Une livraison n'est acceptable qu'apres test sur un Windows propre ou une VM propre.
- Tout echec de mise a jour doit permettre un rollback sans perdre missions, audit ou coffre.

## Lots de realisation

### 19.1 - Integration verticale finale

- Raccorder Telegram et dashboard a l'API reelle.
- Raccorder API, repositories PostgreSQL, queues Redis, Supervisor et Desktop Agent.
- Raccorder Tool Registry, Policy Engine, approbations/PIN et action receipts.
- Raccorder AI Gateway aux modeles configures et au runtime local.
- Raccorder Browser Agent, memoire, scheduler, monitoring, artefacts et notifications.
- Eliminer tous les adaptateurs temporaires et doubles en memoire hors tests.

### 19.2 - Assistant de configuration

- Detecter Windows, Node, Docker/containers, Git, Chrome/Edge et capacites CPU/RAM/GPU/disque.
- Initialiser le coffre DPAPI et demander le PIN a six chiffres sans l'afficher ni le journaliser.
- Ajouter token Telegram et cles fournisseurs par saisie masquee.
- Tester chaque credential par une operation minimale sans enregistrer le contenu.
- Configurer le modele local, les modeles cloud autorises et le modele par defaut.
- Appairer l'unique Owner Telegram avec code local a usage unique.
- Enregistrer un premier projet et generer son manifeste apres confirmation.

### 19.3 - Runtime local Windows

- Fournir scripts `start`, `stop`, `status`, `doctor` et `logs`.
- Demarrer API, workers, bot, Desktop Agent, PostgreSQL/Redis et dashboard dans le bon ordre.
- Utiliser Windows Service ou Task Scheduler avec compte et privileges minimaux.
- Ajouter healthchecks, readiness, timeouts et arret propre.
- Ne jamais ouvrir de fenetre visible pour les services de fond.
- Garantir une seule instance et gerer les ports deja occupes.

### 19.4 - Packaging et cycle de vie

- Produire un installateur versionne et une somme SHA-256.
- Installer sous un repertoire applicatif distinct des donnees `%LOCALAPPDATA%\ARCC`.
- Prevoir desinstallation conservant ou supprimant les donnees selon choix explicite.
- Ajouter migrations automatiques avec sauvegarde prealable et journal de migration.
- Definir mise a jour atomique : staging, verification, bascule, puis rollback automatique.
- Signer les executables/scripts si un certificat est disponible ; documenter sinon l'avertissement attendu.

### 19.5 - Sauvegarde et restauration

- Sauvegarder PostgreSQL, configuration non secrete, coffre chiffre, manifestes, artefacts retenus et audit.
- Chiffrer les sauvegardes contenant des donnees locales sensibles.
- Produire manifeste de sauvegarde avec version, hashes et date.
- Restaurer dans un emplacement de test avant de declarer une sauvegarde valide.
- Tester restauration sur version identique et chemin de migration vers la version suivante.
- Definir retention, rotation et verification periodique.

### 19.6 - Securite finale

- Mettre a jour le modele de menace et verifier chaque frontiere de confiance.
- Scanner dependances, licences, secrets, binaires et configuration.
- Rejouer les tests de traversal, symlink, shell injection, prompt injection, SSRF, CSRF, replay, race et confusion d'action.
- Tester canaris vers chaque fournisseur cloud et Telegram.
- Verifier permissions NTFS des donnees, profils navigateur, sauvegardes, logs et coffre.
- Tester verrouillage PIN, expiration, revocation Owner et rotation des secrets.
- Classer chaque constat ; aucun critique ou eleve ne reste sans acceptation explicite.

### 19.7 - Performance et endurance

- Mesurer demarrage a froid, RAM/CPU au repos, taille disque et latence des queues.
- Benchmarker le modele local sur planification, code, analyse de log et synthese.
- Mesurer premier token, tokens/seconde, pic RAM/VRAM et taux d'erreur.
- Tester missions simultanees respectant les locks par projet.
- Executer une endurance minimale de 24 heures avec scheduler, monitoring et reconnexions.
- Definir seuils d'acceptation adaptes au materiel mesure en phase 00.

### 19.8 - Scenarios E2E de recette

- Installation neuve puis configuration complete.
- Depuis Telegram : choisir projet, machine et modele, creer une mission, approuver par PIN, modifier un projet bac a sable, tester, voir le diff et recevoir le rapport.
- Refaire le scenario depuis le dashboard et verifier un audit identique.
- Interrompre le PC pendant une mission puis verifier reprise sans doublon.
- Tester modele indisponible sans fallback, code refuse au cloud et changement de modele avec confirmation.
- Tester commande interdite, chemin hors sandbox, push/publication sans PIN, callback rejoue et identite Telegram inconnue.
- Tester Browser Agent : domaine hors liste, prompt injection Web, téléchargement dangereux, MFA et action externe.
- Tester schedule en retard, incident regroupe, pause globale et quota atteint.
- Restaurer une sauvegarde puis reproduire un test de fumee.

### 19.9 - Documentation d'exploitation

- Guide d'installation et prerequis Windows.
- Guide de configuration Telegram, PIN, projets et modeles.
- Manuel d'utilisation commandes/dashboard.
- Runbooks : service indisponible, base corrompue, modele en panne, compte Telegram compromis, restauration et rollback.
- Politique de sauvegarde, retention, rotation de cles et mise a jour.
- Limites connues, operations volontairement interdites et cycle futur Linux/VPS.

## Matrice de validation obligatoire

- `pnpm verify` complet.
- PostgreSQL reel : migrations, rollback, persistence et restauration.
- Browser smoke reel avec profil temporaire dedie.
- E2E Telegram sur bot de test et Owner unique.
- E2E dashboard avec navigateur, clavier et mobile.
- Tests de reprise apres kill processus, redemarrage containers et redemarrage Windows.
- Tests de charge locale, quotas et endurance.
- Scan secrets sans faux negatif sur canaris connus.
- Revue manuelle des permissions, refus critiques et journal d'audit.

## Criteres d'acceptation

- Installation sur Windows propre et test de fumee reproductible.
- Scenario global de `PHASES.md` valide avec audit complet.
- Refus prouves pour identites, chemins, commandes, modeles, domaines et sorties cloud interdits.
- Sauvegarde restauree, mise a jour echouee recuperee et mission interrompue reprise sans doublon.
- Mesures locales respectant les seuils fixes ou limites clairement acceptees.
- Aucun defaut critique ou eleve non accepte explicitement.

## Definition de termine

- Installateur, scripts de cycle de vie, assistant de configuration et documentation livres.
- Rapport de recette date avec versions, environnement, resultats et empreintes.
- Sauvegarde/restauration et rollback verifies sur une installation distincte.
- Tous les tests automatiques et manuels obligatoires sont verts.
- Le prototype peut etre exploite au quotidien sans commande de developpement.

## Exclusions

- Linux, macOS, VPS, SaaS et applications mobiles.
- Multi-utilisateur avance.
- Paiement autonome, contournement CAPTCHA/MFA ou exposition Internet.

## Compte rendu

### Livraison preparee

- Release candidate : `0.1.0-rc.1`.
- Archive : `artifacts/releases/arcc-windows-0.1.0-rc.1.zip`.
- SHA-256 : `656dd3ac04c20d411c7cf5cfa9f26d02c5822db841af3653b26627b7a6d56615`.
- Signature Authenticode : absente, faute de certificat ; avertissement Windows documente.
- Services API, Desktop Agent, Telegram et assistant livres avec dependances production materialisees.
- Installation versionnee, desinstallation conservant les donnees, mise a jour atomique et rollback fournis.

### Validations vertes

- `pnpm verify` : format, lint, frontieres, secrets, types, tests et builds verts.
- PostgreSQL 17.6 reel : 44 tables, migrations aller/retour et persistence vertes.
- Runtime Windows reel : bootstrap Owner/projet/machine/modele, dashboard compile, session PIN, creation de mission, benchmark, mini-endurance, sauvegarde/restauration et reprise apres kill API.
- Browser Agent : profil Chrome/Edge temporaire et navigation controlee verts.
- Dashboard Playwright : 10/10 scenarios desktop et mobile verts, sans erreur console ni overflow horizontal.
- Archive : 2 101 fichiers manifestes verifies sans ecart de hash, imports des quatre services verts et sidecar SHA-256 concordant.
- Administration Telegram : 72 tests unitaires verts et scenario PostgreSQL reel couvrant
  reprise, rejet, scheduler, autonomie, incidents, copilotage et purge memoire.
- Installation/desinstallation isolees : application retiree et donnees preservees.
- Worker PostgreSQL reel : reclamation FIFO, verrou projet, planification Supervisor via AI Gateway, fichiers confines, Policy Engine, approbations, recus idempotents, verification et reprise.
- Scheduler et monitoring demarres avec le Desktop Agent ; sondes HTTP/TCP limitees au loopback et notifications d'incident persistantes.
- Notifications Telegram livrees par file durable au seul Owner appaire, avec cinq tentatives maximum ; autorisation explicite recue le 2 octobre 2026.
- Approbation Telegram forte par PIN : challenge expire, verrouille apres cinq erreurs et audite sans secret.
- Credentials Telegram et fournisseurs IA verifies par operation minimale avant stockage dans le coffre DPAPI.
- Projections Telegram assainies pour fichiers, journaux, preuves, plan, file, memoire, moniteurs et scheduler ; aucun objectif, nom de fichier, contenu ou secret n'est exporte.
- Outils systeme et profils terminal du worker actives uniquement lorsqu'un manifeste projet valide les declare explicitement.
- Git, Docker, Browser Agent et Computer Use raccordes au worker de production par extensions de manifeste explicites. Executables, projet Compose, services, images, domaines, applications et fenetres sont bornes ; les approbations fortes sont reverifiees en PostgreSQL juste avant les actions sensibles et Computer Use conserve son arret d'urgence fichier.

### Implementation finale Telegram

- `/retry`, `/takeover` et `/continue` utilisent une confirmation liee a l'etat exact.
- `/screen` n'envoie jamais l'image brute et `/dryrun` n'execute aucun outil.
- Les mutations scheduler, autonomie et incidents appliquent PIN, cooldown, limites,
  unicite de cible, transactions et audit selon leur risque.
- `/forget` purge PostgreSQL et les derives locaux apres confirmation de version et PIN.
- Le scenario d'administration est valide sur PostgreSQL migre reel par
  `scripts/test-telegram-postgres.ts` dans `pnpm test:database`.

### Restant obligatoire avant `TERMINE`

- Installer et rejouer le scenario global sur un Windows ou une VM propre.
- Appairer un bot Telegram de test et un Owner reel ; verifier token, PIN, revocation et notifications.
- Executer le parcours navigateur avec le navigateur et le profil definitifs.
- Tester un redemarrage Windows complet et une mise a jour volontairement echouee sur l'installation cible.
- Executer `endurance.ps1 -Hours 24` et le benchmark du modele local sur le materiel cible.
- Effectuer la revue manuelle NTFS, audit et avertissement de signature.

Aucun de ces controles externes n'est declare reussi sans execution sur l'environnement final.
