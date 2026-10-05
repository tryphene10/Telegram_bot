# Administration Telegram

Le bot n'execute jamais directement une commande systeme. Il selectionne une cible
PostgreSQL unique, produit une confirmation liee a son etat, puis transmet uniquement une
mutation composee et auditee. Un prefixe ambigu est refuse.

## Missions et Computer Use

- `/retry <mission>` : confirme puis remet une mission `BLOCKED` ou `FAILED` dans la file.
- `/takeover <mission-ou-session>` : confirme le passage en controle humain.
- `/continue <mission-ou-session>` : confirme la reprise avec revalidation du contexte.
- `/screen <mission>` : affiche seulement l'etat de session et le nombre de preuves;
  aucune capture brute ne quitte le PC.
- `/dryrun <mission>` : affiche le nombre d'etapes et l'etat sans executer d'action.
- `/reject <approbation>` : rejette une approbation `PENDING` unique et non expiree.

## Operations fortes

Le PIN comporte six chiffres, n'est ni journalise ni persiste en clair, expire et se
verrouille apres cinq erreurs. Il est requis pour reprendre, executer ou archiver une
planification, activer `AUTONOMOUS`, reprendre le scheduler global, redemarrer depuis un
incident et purger la memoire projet.

Les boutons de confirmation contiennent la reference et une empreinte d'etat. Si la cible
change entre l'affichage et la confirmation, l'action est refusee et doit etre rechargee.

## Validation

```powershell
pnpm --filter @arcc/telegram-bot test
pnpm test:database
pnpm verify
```

Le test PostgreSQL couvre les transitions reelles, les contraintes du schema et l'audit;
les tests unitaires couvrent aussi les refus, PIN manquant et references ambigues.
