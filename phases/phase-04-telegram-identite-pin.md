# Phase 04 - Telegram, identite et PIN

## Objectif

Fournir une interface personnelle refusee par defaut a toute autre identite.

## Dependances

Phases 02 et 03 terminees ; token du bot disponible dans le coffre local.

## Travaux

- Integrer Telegram Bot API via webhook local assiste ou long polling adapte au PC local.
- Associer un Telegram User ID unique au compte Owner par une ceremonie d'initialisation locale.
- Refuser et auditer les utilisateurs, chats et callbacks inconnus.
- Implementer sessions, revocation et anti-rejeu des callbacks.
- Implementer le PIN : derive lentement, jamais journalise, tentatives limitees, verrouillage et validite courte.
- Ajouter `/start`, `/help`, `/settings` et un diagnostic de connexion minimal.

## Criteres d'acceptation

- Seul le compte appaire accede au bot.
- Un PIN correct n'autorise que l'action exacte et expiree prevue.
- Brute force, ancien callback et message rejoue sont bloques et audites.
- Aucun token Telegram ou PIN n'apparait dans les sorties.

## Exclusions

Pas encore de commandes de mission completes.

## Compte rendu

Statut : `TERMINEE`.

- Client Telegram Bot API en long polling, sans webhook entrant ni exposition du token dans les erreurs.
- Token charge exclusivement depuis le coffre DPAPI local au demarrage.
- Ceremonie locale a code unique pour associer un seul couple Telegram User ID / Chat ID Owner.
- Etat Owner et identifiants anti-rejeu conserves atomiquement sur disque local.
- Refus et audit local sanitise des identites inconnues, messages rejoues et callbacks anciens.
- Sessions courtes revocables et registre anti-rejeu persistant.
- PIN a six chiffres derive par scrypt, limite a cinq essais, expire et lie a l'action exacte.
- Commandes disponibles : `/start`, `/help`, `/settings` et `/diagnostic` ; aucune commande d'execution.
- Validation finale : 25 tests de securite, 11 tests Telegram, verification monorepo et test PostgreSQL passes.
- Le test reseau Telegram utilise un transport factice ; l'activation reelle attend le token de l'utilisateur dans le coffre.
