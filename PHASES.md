# AI Remote Command Center - Plan d'implementation

## Baseline validee

- Produit personnel et mono-utilisateur dans la premiere version exploitable.
- Execution locale sur un PC Windows. Linux, VPS et fonctionnement SaaS sont hors du premier cycle.
- Interface principale : Telegram.
- Mode d'autonomie initial : `EXECUTE_SAFE`.
- Le code, les diffs, les fichiers projet et les logs bruts ne doivent jamais etre envoyes a un modele cloud.
- Les actions sur le contenu d'un projet utilisent obligatoirement un modele local.
- Les fournisseurs cloud sont accessibles uniquement pour des donnees explicitement classees `CLOUD_SAFE`.
- Fournisseurs prevus : OpenAI/GPT, Anthropic/Claude, DeepSeek, Kimi/Moonshot et moteurs locaux.
- L'utilisateur choisit le fournisseur et le modele par defaut, par mission et, si necessaire, par agent.
- Le modele explicitement choisi doit etre utilise ; aucun remplacement ou fallback automatique n'est permis sans accord prealable.
- Avant une mission, le systeme verifie la compatibilite entre le modele choisi et la classification des donnees requises.
- Validation forte par PIN Telegram, avec expiration, limitation des tentatives et stockage derive du PIN.
- Terminal protege par une liste stricte d'autorisations et des regles de refus deterministes.
- Les stacks techniques sont traitees selon la mission et le manifeste du projet, sans privilegier un langage unique.

## Regle d'execution des phases

1. Une seule phase est active a la fois.
2. Ne pas implementer une phase suivante par anticipation, sauf interface minimale explicitement requise par la phase active.
3. Avant de coder, verifier les dependances et criteres d'entree de la phase.
4. Conserver les changements utilisateur preexistants et produire un `git status` avant toute modification.
5. Une phase n'est terminee que lorsque ses tests et criteres d'acceptation passent.
6. A la fin de chaque phase, mettre a jour sa section `Compte rendu`, documenter les ecarts et s'arreter pour validation.
7. Aucun contournement temporaire d'une regle de securite ne peut etre reporte silencieusement a une phase ulterieure.
8. Les decisions structurantes nouvelles sont consignees sous forme d'ADR dans `docs/adr/`.

## Ordre des phases

Progression actuelle : phases 00 a 18 terminees. L'implementation de la phase 19 est terminee et validee localement ; la promotion finale reste conditionnee par la recette sur Windows/VM propre, le bot Telegram reel, le redemarrage complet et l'endurance 24 h de l'environnement cible.

| Phase | Intitule                           | Resultat principal                                    |
| ----- | ---------------------------------- | ----------------------------------------------------- |
| 00    | Cadrage technique et menaces       | Architecture et frontieres de confiance validees      |
| 01    | Socle monorepo Windows             | Depot compilable, testable et documente               |
| 02    | Domaine, base de donnees et audit  | Persistance locale versionnee                         |
| 03    | Secrets et confidentialite         | Coffre local, redaction et classification des donnees |
| 04    | Telegram, identite et PIN          | Acces personnel authentifie                           |
| 05    | Appairage et protocole machine     | Desktop Agent authentifie et reconnectable            |
| 06    | Projets, manifests et chemins      | Espaces de travail confines                           |
| 07    | Policy Engine et approbations      | Autorisations deterministes centralisees              |
| 08    | Outils locaux fondamentaux         | Filesystem, systeme, fichiers et captures controles   |
| 09    | Terminal securise                  | Processus locaux bornes et auditables                 |
| 10    | Git et Docker controles            | Workflows de developpement et conteneurs securises    |
| 11    | Missions, files et reprise         | Moteur d'execution persistant                         |
| 12    | AI Gateway et Model Router         | Routage multi-modeles respectant la confidentialite   |
| 13    | Supervisor et agents specialises   | Planification, delegation et verification             |
| 14    | Experience Telegram et artefacts   | Pilotage conversationnel complet                      |
| 15    | Browser Agent                      | Navigation locale controlee et validations externes   |
| 15A   | Computer Use Windows Core          | Perception et actions desktop sures et verifiables    |
| 15B   | Autonomie et co-pilotage Windows   | Replanification, reprise humaine et controle UI       |
| 16    | Memoire et base de connaissances   | Contexte local versionne et recherchable              |
| 17    | Scheduler, monitoring et autonomie | Missions recurrentes et surveillance locale           |
| 18    | Dashboard Web local                | Administration et supervision sur localhost           |
| 19    | Durcissement et livraison Windows  | Prototype complet installable et exploitable          |

## Definition globale de termine

Le cycle est termine lorsque le scenario complet suivant passe sur une installation Windows propre : creation Telegram d'une mission, resolution du projet, plan local, execution sure, modification controlee, tests, diff, demande de PIN pour commit, commit autorise, absence de push, rapport final, audit integral et reprise correcte apres redemarrage. Les tests de securite doivent aussi prouver qu'un chemin interdit, une commande refusee, un secret et une donnee `LOCAL_ONLY` ne peuvent pas franchir leur frontiere.

Le scenario doit etre rejoue avec chaque adaptateur configure. Le rapport et l'audit indiquent le fournisseur, l'identifiant exact du modele et tout changement de modele approuve par l'utilisateur.

## Hors perimetre du premier cycle exploitable

- Agent Linux ou macOS.
- Command Center heberge sur VPS et acces Internet entrant.
- Multi-tenant, facturation et administration d'organisations.
- Applications mobiles natives et interfaces WhatsApp, Slack ou Teams.
- Paiements ou publication automatique sans approbation specifique.

Ces extensions feront l'objet d'un second cycle apres validation des performances et de la securite locales.
