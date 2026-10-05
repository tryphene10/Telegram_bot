# ADR 0004 - Runtime IA local abstrait

- Statut : accepte sous benchmark
- Date : 2026-09-13

## Decision

Le fournisseur local est defini par une interface compatible avec une API de generation locale. `llama.cpp` server est la cible de reference pour le benchmark CPU Windows ; Ollama peut etre ajoute comme adaptateur. Le premier candidat est un modele quantifie de classe 7B-8B, sans figer ici une famille de poids.

## Raisons

Le poste dispose de 23,7 Go de RAM mais pas de GPU discret. Une abstraction evite d'enfermer le produit dans un runtime ou un modele et permet de choisir les poids disponibles au moment de la phase 12.

## Consequences

La performance de codage locale reste un risque majeur. La phase 12 doit mesurer qualite, premier token, debit et RAM avant de valider le modele par defaut. Aucun fallback cloud n'est permis pour `LOCAL_ONLY`.
