# Phase 14 - Experience Telegram et artefacts

## Objectif

Rendre toutes les fonctions essentielles pilotables clairement depuis Telegram.

## Dependances

Phases 04, 08, 11 et 13 terminees.

## Travaux

- Implementer langage naturel et commandes `/task`, `/status`, `/tasks`, `/pause`, `/resume`, `/stop`, `/projects`, `/project`, `/machines`, `/machine`, `/models`, `/model`, `/approvals`, `/approve`, `/reject`, `/files`, `/logs`, `/screen`.
- Permettre de choisir GPT/OpenAI, Claude/Anthropic, DeepSeek, Kimi/Moonshot ou un modele local avant une mission, puis d'afficher le choix actif.
- Gerer projet et machine actifs, references contextuelles et clarifications de securite.
- Ajouter boutons details, diff, artefact, commit, push et deploiement avec callbacks anti-rejeu.
- Implementer notifications SILENT, NORMAL et VERBOSE avec limitation de debit.
- Produire rapports, patches, logs sanitises, images et archives avec retention.
- Decouper ou joindre proprement les sorties depassant les limites Telegram.

## Criteres d'acceptation

- Le parcours MVP de bout en bout fonctionne depuis Telegram, sans acces direct au shell.
- Le modele demande est utilise et apparait dans le statut et le rapport ; tout changement exige une confirmation.
- Une reponse dupliquee ou un bouton expire ne rejoue aucune action.
- Les erreurs, blocages et validations indiquent clairement l'etat et la suite.
- Aucun secret ou contenu non autorise n'est renvoye dans Telegram.

## Exclusions

Dashboard Web et navigateur automatise non inclus.

## Compte rendu

Statut : `TERMINEE`.

- Les 19 commandes operationnelles et le langage naturel sont analyses sans exposer de commande shell libre.
- Projet, machine et modele actifs sont controles ; GPT, Claude, DeepSeek, Kimi et local utilisent une selection explicite confirmee par bouton.
- Boutons details, diff, artefact, commit, push et deploiement signes, expires, compacts et a usage unique.
- Toute reponse operationnelle exige une classification et une autorisation Telegram ; `SECRET` est toujours refuse et les canaris sont rediges.
- Rapports et logs sont decoupes sans casser l'UTF-8 ; images/archives suivent taille et retention bornees.
- Notifications SILENT, NORMAL et VERBOSE avec limite de debit et priorite aux alertes de securite.
- Service Telegram raccorde a la couche d'experience sans lui donner de capacite d'execution directe.
- Validation finale au moment de la phase : frontieres d'architecture, 278 tests, typecheck et build complet.
