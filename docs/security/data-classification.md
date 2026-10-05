# Classification et politique d'egress

## Classes

| Classe       | Exemples                                                                     |                      Local |                  Telegram |                Cloud IA |
| ------------ | ---------------------------------------------------------------------------- | -------------------------: | ------------------------: | ----------------------: |
| `PUBLIC`     | documentation publique, question generale                                    |                        Oui |                       Oui |                     Oui |
| `CLOUD_SAFE` | instruction utilisateur explicitement partageable, metadonnees non sensibles |                        Oui |                       Oui | Oui, fournisseur choisi |
| `LOCAL_ONLY` | code, diff, logs, chemins, capture, memoire projet, sortie d'outil           |                        Oui | Apres filtrage et demande |                     Non |
| `SECRET`     | token, PIN, cookie, cle privee, mot de passe                                 | Coffre/execution seulement |                       Non |                     Non |

## Regles

- Toute donnee est `LOCAL_ONLY` par defaut en l'absence de classification certaine.
- Une redaction ne transforme pas automatiquement `LOCAL_ONLY` en `CLOUD_SAFE`.
- Le modele choisi par l'utilisateur est respecte, mais une incompatibilite de classification bloque la mission avant l'envoi.
- Le systeme peut proposer un modele local ou demander une nouvelle instruction ; il ne change jamais silencieusement de modele.
- Toute declassification future exige une action utilisateur explicite, contextuelle, expiree et auditee. Elle n'est pas implementee dans le premier cycle sans nouvelle decision.
- Les secrets sont injectes directement dans l'executor autorise et ne transitent jamais par un prompt.

## Controles techniques

- Un seul module reseau peut joindre les domaines de fournisseurs IA.
- Les packages agents, tools et interfaces ne dependent d'aucun SDK fournisseur.
- Des valeurs canaris sont injectees dans les tests pour detecter une fuite.
- Les journaux d'egress conservent fournisseur, modele, classification, taille et decision, jamais le prompt sensible.
