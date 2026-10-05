# ADR 0001 - Deploiement local Windows

- Statut : accepte
- Date : 2026-09-13

## Decision

Le premier cycle s'execute entierement sur le PC Windows de l'utilisateur. Telegram utilise le long polling sortant. Le dashboard et les services de donnees ecoutent uniquement sur localhost. Aucun port Internet entrant n'est requis.

## Raisons

Le produit est personnel, aucun VPS n'est disponible et les donnees projet doivent rester locales. Les contrats reseau restent toutefois compatibles avec un futur Command Center sur VPS.

## Consequences

Le PC doit etre allume pour recevoir les missions. La disponibilite 24/7 et Linux sont reportes. L'installation finale devra gerer demarrage automatique, sauvegarde et arret propre.
