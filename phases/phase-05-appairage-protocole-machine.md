# Phase 05 - Appairage et protocole machine

## Objectif

Connecter un Desktop Agent Windows au Command Center avec identite, reprise et protection anti-rejeu.

## Dependances

Phases 01 a 04 terminees ; contrat de transport choisi en phase 00.

## Travaux

- Creer l'identite stable de machine et l'appairage par code unique a duree limitee.
- Implementer credentials rotatifs, revocation et stockage local protege.
- Versionner les messages `HELLO`, `HEARTBEAT`, `EXECUTE_TOOL`, progres, resultat, annulation et transfert.
- Ajouter numeros de sequence, `execution_id`, accusés de reception et idempotence.
- Gerer statuts online, offline, busy, maintenance et revoked.
- Implementer reconnexion avec reprise controlee et aucune autorisation implicite.

## Criteres d'acceptation

- Une machine non appairee ou revoquee ne recoit aucune action.
- Une repetition de message n'execute jamais deux fois une operation non idempotente.
- La deconnexion place correctement missions et outils en attente.
- Les contrats de protocole possedent tests de compatibilite et schemas valides.

## Exclusions

Aucun outil dangereux n'est expose par l'agent.

## Compte rendu

Statut : `TERMINEE`.

- Identite machine stable, appairage par code unique expire et credentials de 256 bits.
- Rotation et revocation separees des metadonnees ; stockage du credential compatible avec le coffre DPAPI.
- Protocole `0.1.0` couvrant HELLO, heartbeat, execution, progression, resultat, annulation, transfert et ACK.
- Schemas de payload verifies, identifiants UUID, sequence, horodatage, execution ID et accusé de reception.
- Enveloppes authentifiees HMAC-SHA-256 et refus generique des credentials ou messages alteres.
- Anti-rejeu par fenetre temporelle et sequence strictement croissante avec checkpoint de reprise.
- Etats online, offline, busy, maintenance et revoked ; deconnexion vers `WAITING_RECONNECT`.
- Reprise uniquement avec l'autorisation originale exacte.
- Garde d'idempotence renvoyant le resultat memorise sans reexecuter une operation repetee.
- Transport WebSocket sortant : WSS obligatoire hors loopback et reconnexion exponentielle bornee.
- Inventaire de capacites non intrusif ; aucun outil local active.
- Validation finale : 10 tests protocole, 9 tests Desktop Agent et verification monorepo complete.
