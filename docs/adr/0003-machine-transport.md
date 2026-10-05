# ADR 0003 - Canal WebSocket TLS versionne

- Statut : accepte
- Date : 2026-09-13

## Decision

Le Desktop Agent ouvre une connexion WebSocket TLS sortante vers le Command Center. Sur le PC local elle reste sur loopback. Une autorite locale et une identite cryptographique par machine protegent l'appairage ; nonce, sequence et execution_id protegent du rejeu.

## Raisons

Le canal doit streamer progres et resultats, survivre aux reconnexions et rester reutilisable lorsque le Command Center migrera vers un VPS.

## Consequences

Le protocole doit etre versionne independamment de l'implementation et teste par contrats. Toute erreur d'identite, schema ou sequence ferme la requete.
