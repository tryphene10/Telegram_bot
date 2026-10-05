# Phase 06 - Projets, manifests et chemins

## Objectif

Confiner chaque mission a un espace de travail explicitement autorise.

## Dependances

Phases 02, 03 et 05 terminees.

## Travaux

- Implementer CRUD local des projets, machine principale, racine, stack, environnements et commandes connues.
- Definir et valider un Project Manifest versionne.
- Canonicaliser les chemins Windows, liens, jonctions, chemins UNC, casse et traversals avant toute decision.
- Ajouter listes `allowed`, `denied`, fichiers proteges et limites par sous-repertoire.
- Detecter stack et commandes seulement comme suggestions ; le manifeste reste la source autorisee.
- Ajouter verrous de projet et detection de modifications concurrentes.

## Criteres d'acceptation

- Aucun chemin ne peut sortir de la racine par `..`, lien, jonction ou variante de casse.
- Les profils navigateur, Windows, cles SSH et stores de mots de passe sont interdits par defaut.
- Un manifeste invalide bloque l'execution avec diagnostic.
- Deux ecritures concurrentes incompatibles sont arbitrees.

## Exclusions

Pas d'outil d'ecriture ou terminal actif.

## Compte rendu

Statut : `TERMINEE`.

- CRUD PostgreSQL des projets avec archivage, suppression controlee et concurrence optimiste.
- Migration `0002_project_manifests` aller/retour pour manifeste JSON, version de manifeste et revision.
- Project Manifest v1 strict : machine, racine, stack, environnements, commandes, chemins et quotas.
- Detection de stack limitee a des suggestions avec preuve ; aucune suggestion ne devient autorisation.
- Canonicalisation par `realpath` avant decision, y compris ancetre existant pour une future cible.
- Refus des traversals, sorties par lien/jonction, UNC, chemins device et variantes hors racine.
- Interdiction par defaut des profils navigateur, dossiers de credentials, cles SSH et zones Windows sensibles.
- Precedence deny/protected sur allow et resolution du quota de sous-repertoire le plus specifique.
- Verrous lecture/ecriture a bail et revision optimiste pour arbitrer les missions concurrentes.
- Validation finale : 13 tests tools, 15 tests database, migration Docker 0001+0002 et verification globale passes.
