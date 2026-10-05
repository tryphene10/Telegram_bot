# Architecture locale - AI Remote Command Center

## Vue d'ensemble

Le premier cycle est un produit personnel Windows, local-first. Telegram est une interface distante, mais ne possede aucune capacite d'execution directe.

```text
Telegram
   |
   | Bot API, long polling sortant
   v
Telegram Bot ----> Command Center API <----> Dashboard localhost
                         |
                         +---- PostgreSQL (etat durable + audit)
                         +---- Redis/BullMQ (files et coordination)
                         +---- AI Gateway ----> runtime local
                         |          |
                         |          +---------> fournisseurs cloud autorises
                         |
                         +---- Policy + Approval Engine
                                      |
                                      v
                              Desktop Agent Windows
                                      |
                         Tool Registry + executors locaux
                                      |
                  Computer Use Core + lease UI + kill switch
                                      |
                     Fenetres + UIA + vision/input borne
```

## Processus et responsabilites

### Command Center

Source de verite fonctionnelle. Il authentifie, persiste les missions, planifie les travaux, demande les decisions de politique, publie les evenements et construit les rapports. Il ne touche jamais directement au filesystem ou au terminal projet.

### Telegram Bot

Adaptateur d'interface sans logique d'autorisation propre. Il convertit messages et callbacks en commandes API authentifiees, puis affiche les vues et notifications sanitisees.

### Desktop Agent

Processus distinct sous un compte Windows sans privilege administrateur. Il valide a nouveau identite, schema, chemin, timeout et decision de politique avant d'appeler un executor local.

Le sous-systeme Computer Use observe les fenetres et controles comme des donnees
`DATA_ONLY` et `LOCAL_ONLY`. Une action desktop exige une cible unique, une application
autorisee, un lease UI exclusif, une decision de politique exacte et une verification.
Les entrees UI restent desactivees par defaut et doivent etre activees explicitement.
Le kill switch est un fichier sentinelle local surveille hors processus : son activation
annule les actions en vol et bloque les suivantes jusqu'au rearmement explicite.

### Policy et Approval Engine

Composants deterministes. Un LLM peut proposer une action et fournir un contexte, mais ne peut produire ni modifier une autorisation.

### AI Gateway

Unique point de sortie vers les modeles. Elle applique choix utilisateur, classification, budget, redaction et regles d'egress avant chaque requete.

### Persistance et files

PostgreSQL porte l'etat durable et l'audit. Redis/BullMQ porte les travaux asynchrones ; aucune donnee metier indis pensable ne doit exister uniquement dans Redis.

## Deploiement du premier cycle

- API, bot, Desktop Agent, dashboard et runtime IA : processus Windows locaux.
- PostgreSQL et Redis : conteneurs Docker lies a localhost, volumes persistants explicites.
- Telegram : long polling sortant pour eviter une exposition Internet entrante.
- Dashboard : `127.0.0.1` uniquement par defaut.
- Canal machine : WebSocket TLS sur loopback dans le premier cycle, protocole compatible avec une future connexion distante.

## Regles de dependance

- Une interface appelle l'API ; elle n'appelle jamais un outil.
- Le Supervisor appelle le Tool Registry ; il n'appelle jamais un executor.
- Le Tool Registry exige une decision de politique valide avant transmission.
- Le Desktop Agent rejette toute action sans enveloppe signee, identifiant unique et contraintes locales valides.
- Le Desktop Agent refuse toute saisie si la fenetre de premier plan ne correspond pas a la cible attendue.
- Une seule mission peut detenir le lease global de l'interface graphique.
- Tout SDK de fournisseur IA est encapsule par AI Gateway.

## Evolution prevue

Le passage futur a un VPS deplace Command Center, PostgreSQL, Redis et workers cloud. Telegram conserve la meme API ; le Desktop Agent ouvre une connexion sortante chiffree. Ce changement ne doit pas modifier les contrats de mission, outil, politique ou audit.
