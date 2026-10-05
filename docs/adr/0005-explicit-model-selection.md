# ADR 0005 - Selection explicite du modele et confidentialite

- Statut : accepte
- Date : 2026-09-13

## Decision

Le catalogue inclut OpenAI/GPT, Anthropic/Claude, DeepSeek, Kimi/Moonshot et des modeles locaux. L'utilisateur choisit un modele par defaut et peut le remplacer par mission ou par agent. Le modele choisi est conserve ; un echec met la mission en attente au lieu de declencher un fallback silencieux.

Avant tout appel, AI Gateway compare classification des donnees et capacites du fournisseur. Un modele cloud choisi pour une mission exigeant du contenu `LOCAL_ONLY` est bloque avant envoi et le systeme propose un modele local ou une nouvelle instruction.

## Raisons

L'utilisateur veut controler le modele utilise tout en interdisant l'envoi du code et des logs aux modeles cloud. La selection explicite et la compatibilite fail-closed satisfont les deux exigences sans masquer un changement de fournisseur.

## Consequences

Chaque Agent Run conserve fournisseur et identifiant exact du modele. Une future declassification devra faire l'objet d'une nouvelle decision de securite et d'une autorisation explicite.
