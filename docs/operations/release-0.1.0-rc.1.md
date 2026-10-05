# Rapport de recette 0.1.0-rc.1

Date de preparation : 2 octobre 2026. Mode : `EXECUTE_SAFE`. Cible : Windows local mono-utilisateur.

Archive : `artifacts/releases/arcc-windows-0.1.0-rc.1.zip`. L'empreinte faisant partie de la livraison est dans le sidecar `.sha256`, verifie apres chaque reconstruction.

## Automatise

- Build, lint, types, tests unitaires et controles de frontieres.
- Scan de secrets avec canaris connus.
- PostgreSQL reel : migrations, rollback, persistence, sauvegarde et restauration isolee.
- Runtime Windows : bootstrap, dashboard compile, session PIN, creation de mission reelle, kill/reprise API.
- Installation/desinstallation isolees, imports des quatre services et verification integrale du manifeste.
- Worker de missions PostgreSQL : Supervisor IA, verrou projet, Tool Registry confine, Policy Engine, approbations et recus idempotents.
- Workers scheduler et monitoring actifs ; notifications Telegram persistantes livrees uniquement a l'Owner appaire avec l'autorisation explicite du 2 octobre 2026.
- Approbation Telegram forte par PIN : expiration, cinq tentatives et audit sans PIN.
- Projections Telegram assainies (`files`, `logs`, `proof`, `plan`, `queue`, `memory`, `monitors`, `scheduler`) limitees aux identifiants, etats, categories, tailles, compteurs et horaires ; autorisation explicite recue le 2 octobre 2026.
- Assistant de configuration : verification minimale des credentials Telegram et IA avant stockage DPAPI.
- Dashboard Playwright : 10 scenarios sur desktop et mobile ; Browser Agent avec profil temporaire.
- Scripts PowerShell analyses syntaxiquement ; packaging versionne et manifeste SHA-256.
- Administration Telegram PostgreSQL reelle : reprise de mission, rejet d'approbation,
  planifications, autonomie, pause globale, incidents, copilotage Computer Use et purge
  memoire valides. `/screen` n'exporte que des metadonnees; aucune image brute n'est
  envoyee a Telegram. `/dryrun` ne declenche aucun outil.

## Validation externe obligatoire avant statut final

- Installation depuis zero sur Windows/VM propre.
- Bot Telegram de test et Owner reel, y compris revocation du token.
- Chrome/Edge installe avec profil temporaire et parcours clavier/mobile.
- Redemarrage Windows complet, endurance 24 h et mesures du modele local sur le materiel cible.
- Revue manuelle NTFS, avertissement de signature et journal d'audit.

Tout echec critique ou eleve bloque la promotion de `rc.1`. Les ecarts acceptes doivent etre dates et signes par l'Owner dans ce rapport.

## Etat interne de promotion

- Le worker de production expose les fichiers confines, informations systeme, profils terminal, Git, Docker, Browser Agent et Computer Use uniquement depuis un manifeste valide et identitaire. Les mutations sensibles reverifient l'approbation forte persistee avant execution ; la configuration est documentee dans `advanced-tool-manifest.md`.
- Aucun ecart d'implementation interne critique ou eleve n'est ouvert. Les commandes
  d'administration Telegram sont composees, bornees, auditees et couvertes par tests
  unitaires et PostgreSQL reel.
- L'archive est une release candidate d'installation et de reprise, pas encore une version exploitable quotidiennement de bout en bout.
