# Modele de menace initial

## Actifs critiques

Code et documents projet, secrets, identite Telegram, identite machine, autorisations, integrite du PC, historique d'audit et choix du modele.

## Menaces et mesures

| Menace                                   | Impact                     | Mesures preventives                                      | Preuve attendue                  |
| ---------------------------------------- | -------------------------- | -------------------------------------------------------- | -------------------------------- |
| Compte Telegram inconnu                  | Controle distant           | whitelist d'un User ID, refus par defaut                 | test identite inconnue           |
| Vol de session Telegram                  | Action critique            | PIN court terme, verrouillage, hash d'action             | rejeu et brute force refuses     |
| Prompt injection dans un fichier ou site | Contournement de politique | contenu non fiable, outils/policies hors prompt          | document malveillant sans effet  |
| Traversal, lien ou jonction              | Lecture hors projet        | canonicalisation Windows des deux cotes                  | suite de chemins adverses        |
| Commande terminal obfusquee              | Elevation/exfiltration     | allowlist structuree, deny rules, sans shell par defaut  | corpus de contournements refuse  |
| LLM inventant un outil                   | Execution arbitraire       | Tool Registry schema et allowlist                        | nom/schema inconnu refuse        |
| Rejeu d'une execution                    | Double action              | execution_id, nonce, sequence et idempotence             | meme enveloppe executee une fois |
| Approbation reutilisee                   | Action differente          | hash canonique parametres, expiration                    | parametre modifie refuse         |
| Fuite vers fournisseur cloud             | Confidentialite            | Egress Gateway fail-closed, classification, canaris      | zero requete contenant canari    |
| Secret dans logs/erreurs                 | Exposition                 | coffre, redacteur avant persistence                      | recherche globale negative       |
| Desktop Agent compromis                  | Integrite PC               | compte minimal, defense locale, chemins et outils bornes | enveloppe invalide refusee       |
| Perte reseau ou redemarrage              | Etat incoherent            | persistence, ack, reprise controlee                      | test de coupure sans doublon     |
| Dashboard expose                         | Acces local non voulu      | localhost, session, CSRF, headers                        | scan reseau et tests Web         |
| Dependances compromises                  | Execution de supply chain  | lockfile, audit, versions, revue install                 | controle CI et SBOM final        |

## Principes de reaction

- Fail closed pour identite, classification, policy, transport et schema incertains.
- Une erreur ne doit jamais imprimer un secret ou le contenu complet d'une enveloppe.
- Toute violation ou tentative genere un evenement de securite separe.
- Le bouton stop et la revocation machine priment sur une file ou une reprise automatique.

## Revue de livraison Windows 0.1.0-rc.1

- Les secrets applicatifs et le mot de passe PostgreSQL sont proteges par DPAPI CurrentUser ; les sauvegardes sensibles sont chiffrees de la meme facon.
- L'API et le dashboard sont limites a la boucle locale, avec session PIN, CSRF, CSP et en-tetes de durcissement.
- Les callbacks Telegram sont signes, expires, lies a un etat et consommables une seule fois ; l'identite Owner est unique.
- Les versions applicatives sont immuables et distinctes des donnees ; une mise a jour verifie le manifeste avant bascule et revient au pointeur precedent en cas d'echec.
- Le scan de livraison recherche secrets, cles privees et canaris. La revue NTFS et les tests sur poste propre restent des controles manuels obligatoires.
