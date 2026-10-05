# Exploitation du scheduler et du monitoring

## Valeurs sures

- Fuseau par defaut : `Africa/Douala`.
- Autonomie apres installation ou restauration : `EXECUTE_SAFE`.
- Intervalle et cron minimum : 15 minutes.
- Concurrence : 2 occurrences globales, 1 par projet par defaut.
- Une action dont le resultat est incertain reste `UNKNOWN` et n'est jamais rejouee
  automatiquement.

## Niveaux d'autonomie

`OBSERVE` collecte sans proposer ni executer. `ASSIST` produit une proposition.
`EXECUTE_SAFE` execute uniquement une action LOW explicitement autorisee par le Policy
Engine. `AUTONOMOUS` peut executer une autorisation simple mais ne contourne jamais une
approbation, une approbation forte ou un refus. Son activation exige PIN, apercu exact,
jeton a usage unique et audit.

## Commandes Telegram

- `/schedule <JSON>` cree une planification validee en etat `PAUSED`. Champs requis :
  `name`, `project`, `triggerType`, `expression` et `objective`; champs facultatifs :
  `timezone`, `catchUpPolicy`, `catchUpLimit`, `classification`, `risk` et `model`.
- `/schedules` liste prochaine occurrence, dernier resultat et blocage.
- `/schedule_pause <id>` met en pause sans PIN. `/schedule_resume <id> <PIN>`,
  `/schedule_run <id> <PIN>` et `/schedule_delete <id> <PIN>` exigent une validation
  forte. La suppression archive la definition et conserve son historique.
- `/monitors` et `/incidents` affichent la surveillance et les incidents.
- `/incident <id>` produit des actions liees a l'etat exact : `INVESTIGATE` cree une
  mission de diagnostic, `IGNORE` clot sans effacer, et `RESTART` exige le PIN puis
  applique limites, cooldown et projet cible.
- `/scheduler` affiche leases, files, quotas et incidents. `/scheduler pause` bloque les
  nouvelles reclamations; `/scheduler resume <PIN>` reprend avec une nouvelle generation.
- `/autonomy` affiche le niveau. `/autonomy OBSERVE|ASSIST|EXECUTE_SAFE` le reduit ou le
  borne sans PIN; `/autonomy AUTONOMOUS <PIN>` exige une validation forte liee a l'etat.

Toutes les references abregees doivent designer une seule ligne. Les actions sensibles
reverifient l'etat PostgreSQL au moment de la mutation et sont auditees.

## Reprise apres panne ou veille

Au demarrage, le runtime recupere les leases expires. Les actions deja commencees passent
en `UNKNOWN`. Les echeances manquees appliquent `SKIP`, `LATEST_ONLY` ou `BOUNDED`, puis
la prochaine date est repersistee. L'unicite empeche toute rematerialisation du meme
instant, y compris si l'horloge systeme recule.

Pour un `UNKNOWN`, verifier les preuves de la mission et l'etat cible avant de creer une
nouvelle occurrence. Ne jamais modifier directement son statut en `PENDING`.

## Incident

1. Utiliser `INVESTIGATE` pour demander au Supervisor une collecte bornee.
2. Examiner la cible, l'environnement, le cooldown et le compteur de redemarrages.
3. `RESTART` exige une approbation forte pour un service sensible, la production ou une
   action reseau. La production n'est jamais redemarree sans cette approbation.
4. `IGNORE` clot le traitement utilisateur sans supprimer l'historique.

Les alertes identiques sont groupees dans leur fenetre. Une aggravation, une empreinte
differente et toute alerte `SECURITY` restent notificables. Le niveau Telegram
`SILENT/NORMAL/VERBOSE` s'applique sans supprimer la priorite SECURITY.

## Pause globale

La pause incremente `pause_generation`, empeche toute nouvelle reclamation et fait
echouer la verification juste avant execution des occurrences deja reclamees. Elle ne
tue pas brutalement un effet externe en cours; celui-ci doit terminer ou devenir
`UNKNOWN` si sa preuve se perd.

## Validation

```powershell
pnpm --filter @arcc/scheduler test
pnpm test:database
pnpm verify
```
