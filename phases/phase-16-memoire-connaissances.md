# Phase 16 - Memoire locale et base de connaissances

## Statut

`TERMINEE` - implementation et criteres d'acceptation valides.

## Objectif

Conserver localement le contexte utile des sessions, missions et projets, sans permettre a une connaissance obsolete de remplacer l'etat reel du disque, du depot Git ou de la base operationnelle.

## Dependances obligatoires

- Coffre, classification et Egress Gateway de phase 03.
- Manifeste projet, chemins autorises et sandbox de phase 06.
- Missions durables et reprise de phase 11.
- AI Gateway et modele local de phase 12.
- Supervisor et enveloppes `DATA_ONLY` de phase 13.
- Sessions Computer Use, preuves et profils applicatifs des phases 15A et 15B.

## Principes non negociables

- Toute donnee derivee d'un projet est `LOCAL_ONLY`.
- Embeddings, index, extraits, requetes et resultats de recherche projet ne sortent jamais du PC.
- Le fichier courant, le hash Git et les resultats d'outils priment toujours sur la memoire.
- Une source sans provenance, date et empreinte ne peut pas etre utilisee.
- La suppression d'un projet doit supprimer ou rendre irrécuperables toutes ses donnees derivees.

## Lots de realisation

### 16.1 - Modele de donnees et migration

- Creer la migration `0008_local_knowledge` et sa migration descendante.
- Ajouter `memory_entries`, `knowledge_sources`, `knowledge_chunks`, `knowledge_embeddings`, `knowledge_index_jobs` et `memory_tombstones`.
- Porter sur chaque entree : scope, projet, mission, source, classification, hash SHA-256, version, date d'observation, date d'expiration et statut de fraicheur.
- Definir les scopes `SESSION`, `MISSION`, `PROJECT` et `USER_PREFERENCE`.
- Ajouter contraintes d'unicite, cles etrangeres, index FIFO et index de purge.
- Interdire par contrainte une entree projet sans `project_id` ou sans provenance.

### 16.2 - Ingestion locale

- Indexer uniquement les fichiers autorises par le manifeste : README, Markdown, documentation texte, rapports et decisions explicitement conservees.
- Refuser binaires inconnus, secrets, repertoires exclus, fichiers trop grands et liens sortant du projet.
- Normaliser l'encodage, decouper par sections stables et calculer le hash de chaque source et chunk.
- Envelopper les instructions trouvees dans les documents comme `DATA_ONLY`.
- Rendre l'ingestion idempotente par `(source, hash, version)`.

### 16.3 - Index lexical

- Utiliser la recherche plein texte PostgreSQL locale avec dictionnaire configurable.
- Conserver titre, chemin, symboles, ancres, positions et extrait sanitise.
- Fournir filtres par projet, mission, type de source, date et statut de fraicheur.
- Borner le nombre de resultats, la taille des extraits et le temps de requete.

### 16.4 - Index semantique local

- Utiliser exclusivement un modele d'embedding local passant par la destination `LOCAL_MODEL`.
- Ajouter un espace de noms separe par modele et dimension d'embedding.
- Ne jamais reutiliser un vecteur genere par un autre modele sans reindexation.
- Prevoir un mode lexical seul lorsque le modele local est indisponible ; aucun fallback cloud.
- Mesurer temps d'indexation, RAM, disque et latence de recherche sur un corpus de test.

### 16.5 - Recherche hybride et citations

- Combiner scores lexical et semantique par une formule deterministe documentee.
- Retourner pour chaque resultat : projet, chemin relatif, section, hash, version, date et score.
- Produire des citations locales resolvables vers la source exacte.
- Ne jamais presenter une hypothese comme un fait ; signaler les resultats partiels.
- Revalider la source avant toute decision critique ou ecriture.

### 16.6 - Fraicheur et invalidation

- Detecter changement de mtime, taille, hash fichier, HEAD Git et statut du depot.
- Marquer `STALE` avant reindexation ; ne pas masquer cet etat aux agents.
- Planifier une reindexation incrementale sans bloquer les missions non critiques.
- Annuler les index jobs orphelins et reprendre les jobs interrompus sans doublon.
- Invalider les citations dont la source a ete supprimee ou deplacee.

### 16.7 - Memoire de mission et preferences

- Conserver uniquement decisions, contraintes, resultats verifies et risques utiles.
- Exclure prompts bruts, secrets et sorties volumineuses deja disponibles comme artefacts.
- Versionner les preferences utilisateur et permettre leur correction explicite.
- Implementer expiration differenciee par scope et prolongation explicite auditee.

### 16.8 - Purge et API

- Exposer des ports `ingest`, `search`, `getCitation`, `markStale`, `reindex` et `purgeProject`.
- Ajouter commandes Telegram de consultation et purge avec confirmation forte pour une purge irreversible.
- Produire un rapport de purge indiquant lignes, index et artefacts derives supprimes.
- Ajouter une tache de retention idempotente et auditee.

## Tests obligatoires

- Tests unitaires de decoupage, hashes, scopes, classement hybride et citations.
- Tests canaris prouvant qu'aucun embedding ou extrait projet n'atteint un adaptateur cloud.
- Tests de traversal, symlink, fichier protege, binaire, taille excessive et contenu secret.
- Test PostgreSQL reel : migration montante, redemarrage, descendante et reapplication.
- Test d'invalidation apres modification du fichier et apres changement de HEAD Git.
- Test de reprise d'un index job interrompu sans duplication.
- Test de purge complete d'un projet avec verification des tables et fichiers derives.
- Test de degradation controlee en mode lexical lorsque le modele d'embedding local est indisponible.

## Criteres d'acceptation

- Toute reponse issue de la base indique une provenance locale resolvable.
- Une connaissance obsolete est signalee ou reindexee avant utilisation critique.
- Aucun index, embedding, requete ou extrait projet n'est envoye au cloud.
- Supprimer un projet purge ses donnees derivees conformement a la politique.
- La recherche reste disponible en mode lexical si le runtime local est indisponible.
- Les tests complets du monorepo et PostgreSQL passent.

## Definition de termine

- Migration et rollback valides sur PostgreSQL reel.
- API, repository, workers d'indexation et raccordement Supervisor livres.
- Documentation d'exploitation, limites de taille et politique de retention ajoutees.
- Aucun critere d'acceptation ouvert ; `pnpm verify` vert.

## Exclusions

- Pas de memoire partagee entre utilisateurs.
- Pas de service vectoriel SaaS.
- Pas d'indexation automatique de tout le disque.

## Compte rendu

Statut : `TERMINEE`.

- Migration `0008_local_knowledge` livree avec les six tables prevues, contraintes de
  provenance et de classification, espaces de noms d'embeddings, index GIN, files FIFO,
  reprise de lease, expiration et tombstones de purge. Rollback et reapplication valides.
- Package `@arcc/knowledge` livre avec les ports `ingest`, `search`, `getCitation`,
  `markStale`, `reindex`, `purgeProject` et retention.
- Ingestion UTF-8 locale, idempotente et bornee aux README/Markdown/textes autorises par
  le manifeste. Traversal, lien sortant, fichier protege, binaire, taille excessive,
  secret et type inconnu sont refuses avant persistance.
- Decoupage stable par sections, normalisation NFC/LF, SHA-256 de source et de chunk,
  ancres locales et enveloppe `DATA_ONLY`.
- Recherche plein texte PostgreSQL configurable, filtree et bornee par limite, taille
  d'extrait et timeout. Les citations locales incluent chemin, section, version, date,
  hashes et fraicheur.
- Embeddings exclusivement `LOCAL_MODEL`, sans fallback cloud, avec modele et dimension
  exacts dans le namespace. Le calcul semantique local est borne a 500 candidats.
- Classement hybride documente : 60 % lexical et 40 % semantique. Lorsque le runtime
  local est indisponible, le mode lexical reste disponible et les resultats sont marques
  partiels.
- Taille, mtime, hash fichier, HEAD Git et etat du depot invalident la connaissance et
  programment une reindexation incrementale. Les sources supprimees invalident leurs
  citations ; les jobs orphelins sont annules et les leases expires sont repris sans
  duplication.
- Memoire durable limitee aux decisions, contraintes, resultats verifies, risques et
  preferences. Prompts bruts, secrets et sorties volumineuses sont refuses. Retentions
  par scope, corrections versionnees et prolongations explicites auditees sont livrees.
- Supervisor raccorde aux citations locales revalidees, toujours marquees
  `DATA_ONLY/REFERENCE_ONLY`; le disque, Git et les outils restent prioritaires.
- Commandes Telegram `/memory` et `/forget` ajoutees. La purge exige une autorisation
  forte a usage unique, supprime base et fichiers derives confines, puis produit un
  rapport audite et une tombstone sans contenu.
- ADR de classement/localite et guide d'exploitation ajoutes dans
  `docs/adr/0006-local-hybrid-knowledge.md` et `docs/operations/local-knowledge.md`.

Validation finale :

- `pnpm verify` vert : format, lint, frontieres d'architecture, types, 388 tests et build.
- Package connaissance : 23 tests ; base de donnees : 43 tests ; agents : 28 tests ;
  Telegram : 49 tests.
- `pnpm test:knowledge` vert sur fichier reel : ingestion idempotente, citation resolue,
  invalidation fichier/HEAD, fallback lexical et index semantique local. Corpus de recette
  minimal : 46 octets, un chunk, dimension 384, indexation 0,842 ms, recherche P95
  0,651 ms, delta RSS 40 960 octets et disque estime 3 118 octets. Ces chiffres valident
  le harnais, pas un dimensionnement de production.
- `pnpm test:database` vert sur PostgreSQL ephemere : 38 tables, migration montante,
  recherche lexicale, reprise de job, purge complete, redemarrage, migration descendante,
  reapplication et nettoyage du conteneur/volume.

Aucun critere d'acceptation de la phase 16 ne reste ouvert. L'indexation automatique du
disque entier, la memoire partagee et les services vectoriels SaaS restent exclus.
