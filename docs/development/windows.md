# Developpement Windows

## Installation

```powershell
corepack enable
corepack pnpm install
corepack pnpm verify
```

Si la politique PowerShell bloque `npm.ps1` ou `pnpm.ps1`, utiliser `npm.cmd` ou `corepack pnpm` sans changer la politique globale de la machine.

## Applications

```powershell
corepack pnpm dev:api
corepack pnpm dev:telegram
corepack pnpm dev:agent
corepack pnpm dev:web
```

L'API ecoute par defaut sur `127.0.0.1:4000`. Les autres applications ne font qu'annoncer leur disponibilite pendant la phase 01.

## Verification

`corepack pnpm verify` execute format, lint, typecheck, tests et build. La phase ne peut etre cloturee si une commande echoue.

## Arret d'urgence Computer Use

Le kill switch fonctionne independamment du processus Desktop Agent. Par defaut, son
fichier sentinelle est `%LOCALAPPDATA%\ARCC\computer-use.stop.json`.

```powershell
corepack pnpm computer:status
corepack pnpm computer:stop "demande operateur"
corepack pnpm computer:reset
```

`computer:stop` est idempotent et conserve la premiere raison d'arret. Un fichier
illisible ou invalide bloque les actions par securite. `computer:reset` doit uniquement
etre lance apres verification humaine de la cause de l'arret.

Le chemin peut etre surcharge avec `ARCC_EMERGENCY_STOP_FILE`, notamment pour une
recette isolee.
