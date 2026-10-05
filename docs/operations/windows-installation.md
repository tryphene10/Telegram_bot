# Installation et exploitation Windows

## Prerequis

Windows 10/11 64 bits, Node.js 22.23.0, pnpm 10.15.1, Docker Desktop avec Compose, Git, Chrome ou Edge, 8 Go de RAM et 10 Go de disque libre. Le service reste local et n'ecoute que sur `127.0.0.1`.

## Installation

1. Verifier le poste avec `pnpm runtime:doctor`.
2. Construire la livraison avec `pnpm package:windows`, verifier le fichier `.sha256`, extraire l'archive puis executer `installer\install.ps1`.
3. Executer `scripts\windows\setup.ps1 -FirstProject C:\chemin\du\projet`. Le PIN et le token Telegram sont saisis masques et stockes dans le coffre DPAPI de l'utilisateur Windows.
4. Demarrer avec `scripts\windows\start.ps1`, puis ouvrir `http://127.0.0.1:4000`.
5. Envoyer `/pair CODE` au bot avec le code affiche localement. Un seul compte Owner est accepte.

`EXECUTE_SAFE` est impose par la configuration. Les donnees sont sous `%LOCALAPPDATA%\ARCC`, separees des versions applicatives.

## Commandes courantes

- `start.ps1`, `stop.ps1`, `status.ps1`, `logs.ps1` : cycle de vie local.
- `doctor.ps1` : prerequis, versions, capacite, coffre et exposition reseau.
- `backup.ps1` : sauvegarde chiffree DPAPI et restauration de controle.
- `restore.ps1 -BackupPath <fichier>` : verification isolee ; ajouter `-ConfirmRestore` pour remplacer la base courante.
- `update.ps1 -ArchivePath <zip>` : staging, verification des hashes, sauvegarde, bascule et rollback automatique.
- `benchmark.ps1` et `endurance.ps1 -Hours 24` : mesures locales et endurance.

## Telegram et modeles

Le projet, la machine et le modele doivent etre choisis avant un texte libre : `/projects`, `/project <id-ou-nom>`, `/machines`, `/machine <id-ou-nom>`, `/models`, `/model local:<modele>`. Le changement de modele demande confirmation. Aucun fallback automatique n'est effectue.

Les approbations fortes, publications, push et actions externes restent refusees si la preuve PIN/action exacte n'est pas disponible. Le dashboard utilise une session locale et une protection CSRF.

## Desinstallation

`installer\uninstall.ps1` retire l'application et conserve les donnees. La suppression des donnees exige `-RemoveData` et une confirmation PowerShell explicite.
