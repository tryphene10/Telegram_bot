# Runbooks Windows

## Service indisponible

Executer `status.ps1`, puis `logs.ps1 -Service api`. Verifier `doctor.ps1`. Arreter proprement avec `stop.ps1`, puis relancer. Ne supprimer ni `processes.json` ni la base avant une sauvegarde.

## Base indisponible ou corrompue

Arreter ARCC, lancer `backup.ps1` si PostgreSQL repond encore, puis verifier la derniere sauvegarde avec `restore.ps1 -BackupPath <fichier>`. La restauration reelle exige `-ConfirmRestore` et conserve la base precedente sous `arcc_previous`.

## Modele indisponible

Verifier le runtime local et `/models`. ARCC n'utilise pas automatiquement un autre modele. Reparer le modele choisi ou confirmer explicitement un changement avec `/model fournisseur:modele`.

## Compte Telegram compromis

Arreter le bot, revoquer le token via BotFather, relancer `setup.ps1` avec le nouveau token puis supprimer `telegram-state.json` seulement après sauvegarde afin de forcer un nouvel appairage local. Examiner `telegram-security.jsonl`.

## Mise a jour echouee

`update.ps1` restaure automatiquement le pointeur de version precedent. Consulter les logs, verifier le manifeste et le SHA-256, puis rester sur la version precedente. Les donnees ne sont jamais placees dans le repertoire de version.

## Sauvegarde et retention

Effectuer une sauvegarde quotidienne, conserver 7 quotidiennes, 4 hebdomadaires et 6 mensuelles, puis verifier au moins mensuellement une restauration isolee. Les fichiers `.arccb` sont lies par DPAPI au compte Windows courant : conserver aussi une sauvegarde Windows du profil/cle DPAPI. Faire une sauvegarde avant migration, rotation de secrets ou changement de machine.

## Limites connues

- Windows uniquement ; aucun acces entrant Internet ni fonctionnement VPS.
- Un seul Owner Telegram.
- Signature Authenticode absente tant qu'aucun certificat n'est fourni ; Windows peut afficher un avertissement editeur inconnu.
- CAPTCHA, MFA, paiement et publication autonome sont volontairement interdits.
- Les tests bot Telegram reel, navigateur installe, redemarrage Windows et endurance 24 h necessitent l'environnement final.
