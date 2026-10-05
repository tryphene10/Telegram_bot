# Phase 08 - Outils locaux fondamentaux

## Objectif

Exposer des capacites locales bornees exclusivement via Tool Registry et Policy Engine.

## Dependances

Phases 05 a 07 terminees. Aucun outil ne doit etre active avant ce point.

## Travaux

- Creer les schemas d'entree/sortie, preconditions, risques, timeouts et tailles maximales du Tool Registry.
- Implementer lecture, recherche, creation, modification atomique, copie et deplacement de fichiers autorises.
- Ajouter system info et liste de processus sans donnees sensibles.
- Implementer capture d'ecran avec apercu, compression, masquage configurable, retention et audit.
- Implementer transfert de fichiers Telegram/machine avec validation MIME, extension, taille et destination.
- Ajouter sauvegarde logique ou moyen de retour pour chaque ecriture lorsque possible.

## Criteres d'acceptation

- Aucun outil ne s'execute sans decision de politique attachee.
- Les limites de taille, temps, chemin et sortie sont enforcees cote Desktop Agent.
- Les ecritures sont atomiques et les suppressions utilisent une voie recuperable par defaut.
- Les captures et fichiers temporaires expirent selon la retention.

## Exclusions

Terminal, Git, Docker et navigateur restent desactives.

## Compte rendu

Statut : `TERMINEE`.

- Tool Registry ferme avec schemas entree/sortie, risques, preconditions, delais et plafonds absolus.
- Dix outils bornes : lecture, liste, recherche, ecriture atomique, copie, deplacement, suppression recuperable, informations systeme, processus expurges et capture d'ecran.
- Porte Desktop Agent enrichie avec decision de politique et hash d'action ; un `DENY` ne peut pas atteindre un adaptateur.
- Chemins controles par manifeste, limites de tailles enforcees, sauvegardes et jetons de retour arriere pour les mutations.
- Transferts valides par MIME, extension, signature, taille et destination ; executables refuses.
- Capture Windows reelle avec masques, PNG, apercu JPEG compresse, classification `LOCAL_ONLY`, audit et expiration persistante apres redemarrage.
- Validation : verification complete du monorepo reussie, 33 tests du paquet outils, 13 tests Desktop Agent et test Windows reel (capture 1 126 131 octets, apercu 12 229 octets), artefacts supprimes immediatement.
- Terminal, Git, Docker et navigateur restent absents du registre.
