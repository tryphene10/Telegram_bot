# Phase 09 - Terminal securise

## Objectif

Executer sur Windows des commandes explicitement permises, bornees et observables.

## Dependances

Phases 06 a 08 terminees ; profils d'allowlist definis sur un projet de test.

## Travaux

- Implementer profils de commandes autorisees par projet avec executable, arguments, cwd et environnement.
- Ajouter parseur et refus deterministes pour shell imbrique, encodage obscur, redirection interdite, elevation et contournements.
- Executer sans shell lorsque possible ; isoler PowerShell/cmd lorsque necessaire.
- Ajouter timeout, streaming borne, stdout/stderr redactes, annulation et arret de l'arbre de processus.
- Restreindre variables d'environnement, acces reseau et repertoire de travail selon profil.
- Classer installation de dependance et processus persistants avec approbation adaptee.

## Criteres d'acceptation

- Une commande absente de l'allowlist est refusee avant creation de processus.
- Les variantes connues de contournement sont testees et bloquees.
- Timeout et annulation ne laissent aucun processus enfant orphelin.
- Les secrets presents dans une sortie sont redactes avant stockage ou affichage.

## Exclusions

Pas de terminal arbitraire ni d'elevation administrateur automatique.

## Compte rendu

Statut : `TERMINEE`.

- Les commandes proviennent exclusivement de profils nommes du manifeste : executable Windows absolu, arguments exacts, repertoire, environnement, reseau et limites.
- L'execution utilise `spawn` avec `shell: false`. Les shells, scripts interpretes, LOLBins, Git et Docker sont refuses dans cette couche.
- Les syntaxes de shell, redirections, elevations, commandes encodees, evaluations d'interpreteur et arguments opaques sont bloques avant la creation du processus.
- Les sorties sont bornees et redactees avant streaming, stockage et audit, y compris les blocs de cle privee multilignes.
- Timeout, annulation et depassement de sortie terminent l'arbre Windows avec `taskkill /T /F` et signalent tout echec laissant le processus actif.
- Les installations, processus persistants et acces reseau sont exposes comme categories distinctes au Policy Engine, avec risque et approbation adaptes.
- Ecart volontaire : PowerShell et cmd restent entierement indisponibles en mode `EXECUTE_SAFE`; seuls des executables directs explicitement autorises sont acceptes.
- Validation : verification complete du monorepo reussie ; 49 tests outils, 21 tests de politique et 24 tests Desktop Agent, dont une execution Windows reelle de `whoami.exe` sans shell.
