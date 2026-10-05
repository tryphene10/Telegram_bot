# Exploitation de la memoire locale

## Perimetre indexable

Seuls les README, fichiers Markdown et textes explicitement autorises par le manifeste
projet sont acceptes. Les repertoires exclus, chemins hors projet, liens sortants,
fichiers proteges, binaires, UTF-8 invalide et contenus contenant un secret sont refuses.

Limites par defaut :

- 1 Mio par fichier, configurable jusqu'a 10 Mio ;
- 4 000 caracteres par chunk, maximum 20 000 ;
- 50 resultats et 4 000 caracteres d'extrait par recherche ;
- 2 secondes par requete lexicale, maximum 10 secondes ;
- 256 chunks par lot d'embedding et 500 vecteurs candidats par recherche semantique.

## Fraicheur et citations

Le service compare taille, mtime, SHA-256, HEAD Git et etat propre/sale. Toute variation
marque la source `STALE` avant de programmer une reindexation incrementale. Une source
supprimee devient `DELETED` et ses citations ne sont plus resolvables. Une decision
critique exige une revalidation physique.

Les URI locales suivent la forme
`arcc://knowledge/<source>/<section>?source=<hash>&chunk=<hash>&v=<version>`.
Elles ne sont jamais transformees en URL publique.

## Retention

- session : 24 heures ;
- mission : 30 jours ;
- projet : 180 jours ;
- preference utilisateur : 365 jours.

Une prolongation explicite est bornee a deux ans et auditee. La tache de retention est
idempotente et marque les lignes `EXPIRED`. Les prompts bruts, secrets et sorties
volumineuses deja conservees comme artefacts ne sont jamais memorises.

## Commandes et purge

`/memory <requete>` consulte la connaissance du projet actif. `/forget <projet>` renvoie
une confirmation `PURGE_MEMORY` liee a la version exacte du projet. La commande confirmee
`/forget PURGE_MEMORY:<projet>:<etat> <PIN>` est la seule forme qui declenche l'effacement.
Le rapport final contient les nombres de sources,
chunks, embeddings, entrees, jobs et fichiers derives supprimes ainsi qu'une empreinte de
purge. La tombstone restante ne contient aucun extrait ni vecteur.

## Verification

- `pnpm test:knowledge` : ingestion, idempotence, citation, invalidation et mesures ;
- `pnpm test:database` : migration 0008, recherche lexicale, reprise de job, purge,
  redemarrage PostgreSQL et rollback/reapplication ;
- `pnpm verify` : format, lint, frontieres, types, tests et build du monorepo.
