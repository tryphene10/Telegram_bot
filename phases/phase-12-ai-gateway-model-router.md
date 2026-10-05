# Phase 12 - AI Gateway, selection et Model Router

## Objectif

Supporter plusieurs modeles choisis par l'utilisateur tout en garantissant que le contenu projet reste local.

## Dependances

Phases 00, 03 et 11 terminees ; runtime local selectionne et secrets fournisseurs configures.

## Travaux

- Integrer au moins un runtime local compatible avec le materiel mesure en phase 00.
- Creer des adaptateurs interchangeables : local/Ollama ou equivalent, OpenAI/GPT, Anthropic/Claude, DeepSeek, Kimi/Moonshot, puis autres fournisseurs configures.
- Implementer un catalogue de fournisseurs et de modeles disponibles, avec capacites, contexte, cout, disponibilite et classification maximale acceptee.
- Permettre une selection explicite par defaut, par mission et par agent ; propager ce choix sans substitution silencieuse.
- Imposer le passage de tout prompt par classification, redaction, budget et Egress Gateway.
- Router les taches contenant code, fichiers, diffs, logs, captures ou memoire projet vers `LOCAL_ONLY`.
- Limiter les modeles cloud aux requetes `CLOUD_SAFE` explicitement autorisees et desactivees par defaut.
- Si le modele choisi est incompatible avec les donnees requises, bloquer avant envoi et proposer un modele local ; ne changer de modele qu'apres accord.
- Mesurer latence, tokens, cout estime, erreurs et changements approuves sans journaliser le contenu sensible.

## Criteres d'acceptation

- Les tests canaris demontrent zero fuite vers chaque adaptateur cloud.
- Desactiver un fournisseur ne casse pas les contrats communs.
- Aucun fallback cloud n'est possible pour une tache `LOCAL_ONLY`.
- GPT, Claude, DeepSeek, Kimi et le moteur local peuvent etre selectionnes explicitement lorsqu'ils sont configures.
- Une panne de modele produit un etat controle et demande le choix de l'utilisateur, jamais une substitution silencieuse ou une baisse de confidentialite.
- L'audit enregistre fournisseur et identifiant exact du modele pour chaque Agent Run.

## Exclusions

Pas encore de Supervisor autonome.

## Compte rendu

Statut : `TERMINEE`.

- Catalogue et selection explicite par defaut, mission ou agent pour Ollama, GPT, Claude, DeepSeek et Kimi/Moonshot.
- AI Gateway unique avec classification recalculee, budgets, redaction, Egress Gateway et absence totale de fallback silencieux.
- Transport HTTP securise : destinations exactes, HTTPS cloud, boucle locale pour Ollama et resolution tardive des secrets.
- Tests canaris contre chaque fournisseur cloud, controle de l'identifiant retourne et audit SQL sans contenu sensible.
- Benchmark local reproductible avec seuils de latence, debit et memoire.
- Migration PostgreSQL `0005_model_routing` validee en montee, redemarrage, descente et reapplication.
- Validation finale au moment de la phase : format, lint, frontieres d'architecture, typecheck, 243 tests et build complet.
