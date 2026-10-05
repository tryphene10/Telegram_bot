# Phase 00 - Cadrage technique et menaces

## Objectif

Transformer le cahier des charges et les decisions utilisateur en architecture implementable avant de choisir les details irreversibles.

## Dependances

Aucune. Cette phase ouvre le projet et ne lance pas encore le developpement.

## Travaux

- Inventorier le PC Windows : CPU, RAM, GPU/VRAM, espace disque, WSL2, Docker Desktop et capacite a executer des modeles locaux.
- Definir les processus : API Command Center, bot Telegram, Desktop Agent, workers, base et interface Web.
- Produire les diagrammes de composants, flux de donnees et frontieres de confiance.
- Definir les classifications `PUBLIC`, `CLOUD_SAFE`, `LOCAL_ONLY`, `SECRET` et les flux permis.
- Etablir le modele de menace : vol du bot, prompt injection, traversal, elevation terminal, rejeu, exfiltration, faux agent et validation reutilisee.
- Rediger les ADR sur la base locale, la queue, le transport temps reel, le modele local et le packaging Windows.
- Fixer les budgets de ressources, de latence et de stockage.

## Criteres d'acceptation

- Chaque composant a une responsabilite et une frontiere explicites.
- Aucun flux `LOCAL_ONLY` ou `SECRET` ne mene vers un fournisseur cloud.
- Le materiel permet un modele local retenu, ou une strategie locale realiste est documentee.
- Les menaces critiques possedent une mesure preventive et un test prevu.

## Exclusions

Aucun code produit ni appel reel a un fournisseur IA.

## Compte rendu

Statut : `TERMINEE`.

Terminee le 13 septembre 2026.

- Inventaire materiel et logiciel consigne dans `docs/architecture/resource-budgets.md`.
- Architecture, flux et frontieres de confiance documentes.
- Classification et politique d'egress fail-closed validees.
- Modele de menace initial et preuves attendues definis.
- Cinq ADR acceptes, dont le runtime local reste soumis au benchmark de phase 12.
- Aucun code produit ni appel fournisseur n'a ete realise pendant cette phase.
