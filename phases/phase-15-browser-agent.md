# Phase 15 - Browser Agent

## Objectif

Ajouter une navigation locale controlee lorsque API ou CLI ne conviennent pas.

## Dependances

Phases 03, 07, 08, 11, 13 et 14 terminees.

## Travaux

- Utiliser un profil navigateur dedie sans reutiliser le profil personnel.
- Implementer ouverture, lecture, extraction, telechargement, televersement, formulaire et clic reversible.
- Appliquer allowlist de domaines, limites de telechargement et classification du contenu.
- Traiter le contenu Web comme non fiable et isoler ses instructions de celles de l'utilisateur.
- Exiger une approbation forte pour `SEND`, `PAY`, `DELETE`, `PUBLISH`, connexion sensible et equivalents.
- Capturer preuve avant/apres et journaliser URL, action et resultat sans secrets.

## Criteres d'acceptation

- Le navigateur ne peut acceder aux profils, cookies ou mots de passe personnels.
- Une page ne peut provoquer un appel d'outil ou une exfiltration par prompt injection.
- Les actions externes irreversibles sont bloquees sans PIN lie a l'action exacte.
- Telechargements dangereux ou hors limites sont mis en quarantaine/refuses.

## Exclusions

Pas de paiement autonome ni contournement de CAPTCHA/MFA.

## Compte rendu

Statut : `TERMINEE`.

- Service navigateur local controle ajoute avec profil dedie obligatoire et refus explicite des profils Chrome/Edge personnels.
- URLs HTTPS limitees a une allowlist exacte ; identifiants integres aux URLs et domaines hors liste refuses.
- Contenu de page retourne uniquement comme `DATA_ONLY` et `LOCAL_ONLY`, sans capacite d'appeler un outil.
- SEND, DELETE, PUBLISH et connexion sensible exigent un PIN lie a l'empreinte exacte ; paiement autonome toujours interdit.
- Preuves avant/apres et audit d'URL sans query pour les actions mutantes ; CAPTCHA/MFA renvoyes a l'utilisateur.
- Telechargements relies au garde de transfert existant et mis en quarantaine en cas de refus.
- Pilote concret `PlaywrightChromeDriver` branche sur Chrome/Edge installe, sans telechargement de navigateur ni reutilisation du profil personnel.
- Contexte persistant dedie, service workers bloques, permissions vides et interception de toutes les requetes hors allowlist.
- Ouverture, lecture, extraction, clic, formulaire, upload, download et actions externes implementes avec selecteurs stricts et limites de sortie.
- Registre `browser.read`, `browser.download`, `browser.interact`, `browser.upload` et `browser.external` avec risques separes et prevention de confusion d'action.
- Test de fumee reel valide sur Chrome headless avec profil temporaire isole et nettoyage verifie.
- Validation finale : smoke test Chrome reel, test de quarantaine, 284 tests automatises, typecheck, build et validation globale du monorepo.
