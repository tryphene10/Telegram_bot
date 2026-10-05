# Budgets locaux et contraintes materielles

## Inventaire du 13 septembre 2026

- Windows 11 Professionnel 64 bits, version 10.0.26200.
- Intel Core i7-1365U, 10 coeurs et 12 processeurs logiques.
- 23,7 Go de RAM utilisable.
- Intel Iris Xe integre, memoire declaree 2 Go ; aucune VRAM discrete.
- Disque C : 167,7 Go, 32,7 Go libres.
- Disque D : 201,6 Go, 22,1 Go libres.
- Node.js 22.23.0, npm 10.9.8, Git 2.54.0, Docker 29.7.2 et WSL2 presents.
- pnpm et runtime local de modele absents au moment de l'inventaire.

## Consequences

- Le modele local doit pouvoir fonctionner principalement sur CPU/RAM.
- Commencer les benchmarks avec un modele instruct/code quantifie de classe 7B-8B.
- Tester eventuellement une classe 14B, sans la retenir si elle degrade l'usage interactif.
- Le runtime doit exposer une API locale standard ; `llama.cpp` server est la cible de reference, Ollama reste un adaptateur possible.
- Aucun modele ni cache ne doit etre telecharge sans verifier l'espace disque et obtenir l'accord utilisateur au moment de l'installation.

## Budgets cibles

| Ressource                         | Cible initiale               |
| --------------------------------- | ---------------------------- |
| Services hors modele au repos     | <= 1,5 Go RAM                |
| Base + Redis au repos             | <= 1 Go RAM                  |
| Accuse Telegram hors travail long | p95 <= 2 s                   |
| Demarrage services locaux         | <= 60 s                      |
| Premier token local 7B quantifie  | cible <= 30 s                |
| Debit local utile                 | cible >= 3 tokens/s          |
| Sortie terminal par execution     | bornee, valeur initiale 1 Mo |
| Retention logs terminal           | 30 jours configurable        |
| Retention captures                | 7 jours configurable         |
| Retention temporaire              | 24 heures                    |

Ces valeurs sont des garde-fous initiaux. Les phases 12 et 19 les mesurent et documentent tout ajustement.
