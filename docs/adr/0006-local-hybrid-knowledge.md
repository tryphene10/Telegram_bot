# ADR 0006 - Index de connaissance hybride strictement local

## Statut

Accepte pour la phase 16.

## Decision

Les sources projet, chunks, embeddings, requetes et resultats de recherche restent sur
la machine. PostgreSQL fournit l'index lexical et la persistance durable. Les embeddings
sont produits uniquement par un adaptateur declare `LOCAL_MODEL`, puis stockes dans un
espace de noms `modele:dimension`.

Le classement hybride utilise la formule deterministe suivante :

`score = 0,60 * score_lexical + 0,40 * score_semantique`

Les scores sont bornes entre 0 et 1. En l'absence du runtime local, la recherche reste
disponible en mode lexical et chaque resultat est marque partiel. Aucun fallback cloud
n'est autorise.

Une citation contient le projet, le chemin relatif, la section, la version, les hashes de
source et de chunk, la date d'observation et l'etat de fraicheur. Toute utilisation
critique revalide la source physique avant de l'exposer au Supervisor.

## Consequences

- Les vecteurs ne peuvent pas etre reutilises entre modeles ou dimensions.
- Le fichier, l'etat Git et les outils operationnels restent prioritaires sur l'index.
- La suppression d'un projet purge les donnees derivees et laisse uniquement une
  tombstone sans contenu, avec compteurs et empreinte de purge.
- Le calcul de similarite en application est borne a 500 candidats par requete dans la
  premiere version ; un index vectoriel natif pourra etre evalue ulterieurement.
