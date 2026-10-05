# Flux de donnees et frontieres de confiance

## Frontieres

| Frontiere                         | Niveau de confiance       | Controle obligatoire                                |
| --------------------------------- | ------------------------- | --------------------------------------------------- |
| Telegram vers bot                 | Externe non fiable        | User ID, chat autorise, anti-rejeu, limite de debit |
| Bot vers API                      | Application locale        | Authentification de service, schema, correlation    |
| API vers AI Gateway               | Interne sensible          | Classification et budget obligatoires               |
| AI Gateway vers cloud             | Externe non fiable        | `CLOUD_SAFE` uniquement, allowlist fournisseur      |
| Command Center vers Desktop Agent | Execution privilegiee     | TLS, identite machine, policy grant, execution_id   |
| Desktop Agent vers projet         | Donnees locales sensibles | Racine canonique, allowlist outil, compte minimal   |
| Dashboard vers API                | Interface locale          | Session, CSRF, origine et localhost                 |

## Flux de mission

1. Telegram recoit l'objectif et l'identite externe.
2. Le bot authentifie l'identite et cree une commande sanitisee.
3. L'API resout projet, machine et modele explicitement choisi.
4. Le Supervisor prepare un plan ; tout contenu projet est `LOCAL_ONLY`.
5. AI Gateway verifie si le modele choisi peut recevoir les donnees requises.
6. Chaque intention d'outil est evaluee par Policy Engine.
7. Une action sensible attend une approbation liee a ses parametres exacts.
8. Le Desktop Agent revalide l'enveloppe et execute dans le perimetre du projet.
9. Le resultat est redacte, persiste, verifie et resume.
10. Telegram ne recoit que le rapport et les artefacts explicitement autorises.

## Flux interdit

Les chemins suivants n'existent pas dans l'architecture : Telegram vers terminal, LLM vers executor, interface Web vers Desktop Agent, outil vers fournisseur IA, fallback `LOCAL_ONLY` vers cloud, lecture directe d'un secret par un modele.
