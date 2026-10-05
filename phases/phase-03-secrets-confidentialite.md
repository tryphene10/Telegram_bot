# Phase 03 - Secrets et confidentialite

## Objectif

Rendre techniquement impossible l'envoi involontaire de code, logs ou secrets vers le cloud.

## Dependances

Phases 01 et 02 terminees ; classifications de donnees validees en phase 00.

## Travaux

- Implementer un coffre chiffre local lie a Windows et separer valeurs secretes et metadonnees.
- Creer un classificateur de donnees obligatoire sur chaque entree/sortie IA.
- Construire le redacteur de tokens, mots de passe, cookies, cles privees et motifs configurables.
- Ajouter un `Egress Gateway` unique : refus par defaut, destinations autorisees et journalisation sans contenu sensible.
- Bloquer les appels cloud contenant code, diff, contenu fichier, log terminal, capture, memoire projet ou secret.
- Implementer rotation, revocation et effacement controle des secrets.

## Criteres d'acceptation

- Des tests canaris prouvent qu'aucune valeur `LOCAL_ONLY` ou `SECRET` ne sort.
- Un module ne peut pas appeler directement un SDK IA ou HTTP de fournisseur en contournant la gateway.
- Les secrets ne figurent ni dans logs, erreurs, rapports, base en clair, ni prompts.
- Redemarrage et rotation ne rendent pas le coffre incoherent.

## Exclusions

Pas encore d'adaptateur fournisseur reel hors test factice.

## Compte rendu

Statut : `TERMINEE`.

- Coffre AES-256-GCM local ; cle maitresse protegee par DPAPI pour le compte Windows courant.
- Valeurs chiffrees separees des metadonnees, ecriture fichier atomique, revocation, suppression et rotation.
- Classification obligatoire et fermee par defaut pour code, diff, fichiers, logs, captures, memoire et sorties d'outil.
- Redacteur de jetons, mots de passe, cookies, cles privees et motifs canaris configurables.
- Egress Gateway centralisee : destination allowlistee, modele explicite et blocage de `LOCAL_ONLY`/`SECRET` vers le cloud.
- Audit d'egress limite au fournisseur, modele, classification, taille, decision, raison et correlation.
- Controle statique interdisant les SDK fournisseurs, clients HTTP usuels et `fetch` direct hors gateway.
- Validation finale : 22 tests de securite, dont canaris cloud et aller-retour DPAPI reel sous Windows.
