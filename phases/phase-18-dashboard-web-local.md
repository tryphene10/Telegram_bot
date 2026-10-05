# Phase 18 - Dashboard Web local

## Statut

`TERMINEE` - contrats, API locale sécurisée, dashboard responsive et validation automatisée livrés.

## Objectif

Fournir une interface locale complete d'administration, de pilotage et d'observabilite, sans introduire de chemin alternatif contournant l'API, le Policy Engine, le PIN ou l'audit.

## Dependances obligatoires

- API locale stabilisee et repositories des phases precedentes.
- Supervisor, artefacts Telegram, memoire, scheduler et monitoring termines.
- Services lies uniquement a `127.0.0.1` par defaut.

## Principes non negociables

- Le navigateur Web ne parle jamais directement a PostgreSQL, Redis, aux outils ou aux fournisseurs IA.
- Toutes les mutations passent par les memes services applicatifs et politiques que Telegram.
- Aucun secret brut, prompt sensible ou contenu non autorise n'est retourne au frontend.
- Toute action critique affiche l'empreinte exacte, exige le PIN requis et reste a usage unique.
- Le dashboard ne doit pas ecouter sur `0.0.0.0` ni sur une interface LAN par defaut.

## Lots de realisation

### 18.1 - Contrats API

- Definir des DTO versionnes pour utilisateurs, machines, projets, missions, approbations, agents, modeles, schedules, incidents, artefacts, audit et usage.
- Ajouter pagination par curseur, filtres bornes, tri allowliste et erreurs structurees.
- Ne jamais exposer chemins absolus lorsque le chemin relatif suffit.
- Ajouter endpoints de sante, readiness et diagnostic sanitise.
- Generer ou verifier les contrats entre API et frontend dans les tests.

### 18.2 - Session locale et securite HTTP

- Creer une session locale courte apres PIN ou preuve locale equivalente.
- Cookies `HttpOnly`, `SameSite=Strict`, `Secure` lorsque TLS local est active et rotation de session.
- Protection CSRF liee a la session pour toute mutation.
- Ajouter CSP stricte, `frame-ancestors 'none'`, `nosniff`, referrer policy et permissions policy.
- Verifier `Origin`, `Host` et adresse d'ecoute ; refuser les origines non locales.
- Limiter debit, taille des corps et tentatives PIN.

### 18.3 - Socle frontend

- Mettre en place React/TypeScript avec routage, client API type et gestion d'erreurs coherente.
- Definir design tokens, themes clair/sombre, etats loading/empty/error/blocked et composants accessibles.
- Construire navigation laterale desktop et navigation compacte mobile.
- Ajouter raccourcis clavier sans intercepter ceux du navigateur.
- Ne stocker aucun secret ou token persistant dans `localStorage`.

### 18.4 - Vues principales

- `Overview` : sante, missions actives, incidents, approbations et consommation.
- `Machines` : etat, capacites, derniere activite, appairage et revocation.
- `Projects` : manifeste, stack, chemins, commandes et etat Git sanitise.
- `Missions` : creation, modele exact, progression, plan, timeline, preuves, pause/reprise/annulation.
- `Approvals` : apercu exact, risque, empreinte, expiration, PIN et decision.
- `Agents` : statut, modele, budget, iterations, outils permis et erreurs.
- `Schedules` et `Incidents` : prochaine occurrence, historique, anti-flapping et actions proposees.
- `Artifacts` et `Logs` : classification, retention, telechargement autorise et purge.
- `Usage` : tokens, couts estimes, latence, CPU/RAM/disque sans contenu sensible.
- `Settings` et `Security` : fournisseurs, coffre, retention, autonomie, allowlists et audit.

### 18.5 - Temps reel fiable

- Utiliser SSE ou WebSocket local authentifie avec curseur d'evenement.
- Reprendre apres reconnexion a partir du dernier curseur confirme.
- Dedoublonner par identifiant et sequence ; detecter les trous et resynchroniser.
- Appliquer backpressure et limiter la taille des evenements.
- Ne transmettre que des projections sanitisees.

### 18.6 - Actions et approbations

- Afficher parametres, projet, machine, environnement, modele, risque et empreinte avant confirmation.
- Reutiliser ApprovalService et PinAuthorizationService, sans logique de decision dans le frontend.
- Expirer les dialogues et tokens ; rendre un double clic inoffensif.
- Afficher clairement `DENY`, `WAITING_APPROVAL`, `BLOCKED`, `FAILED` et l'action attendue.
- Exiger une nouvelle evaluation apres changement d'etat ou expiration.

### 18.7 - Accessibilite et responsive

- Navigation complete au clavier, focus visible, labels, annonces live et ordre semantique.
- Contraste WCAG AA pour les informations essentielles.
- Supporter au minimum 360 px de largeur sans perte d'action critique.
- Respecter reduction des animations et zoom navigateur.
- Tester lecteurs d'ecran sur les dialogues d'approbation et timelines.

### 18.8 - Observabilite et exploitation

- Correlation ID sur chaque requete et action.
- Journaliser route, statut, duree et resultat sanitise, jamais cookies/PIN/secrets.
- Afficher les composants indisponibles et modes de degradation.
- Ajouter une page diagnostic exportable sans donnees sensibles.

## Tests obligatoires

- Tests unitaires composants, stores, formatters, permissions d'affichage et erreurs.
- Tests de contrats API/DTO et schemas runtime.
- Tests d'integration session, CSRF, origine, host, cookies et headers.
- E2E navigateur sur Overview, projet, creation de mission, modele, approbation, timeline et artefact.
- Test prouvant qu'une requete directe ne contourne ni politique ni audit.
- Tests de reconnexion temps reel, curseur, ordre et dedoublonnage.
- Tests clavier, axe/accessibilite et largeurs 360/768/desktop.
- Test d'exposition reseau confirmant une ecoute uniquement sur loopback.
- Tests de fuite avec canaris dans API, DOM, console, logs et export diagnostic.
- `pnpm verify` et build production sans erreur console.

## Criteres d'acceptation

- Aucun endpoint Web ne contourne le Policy Engine ou l'audit.
- Le dashboard n'est pas expose au reseau local par defaut.
- Les vues essentielles fonctionnent au clavier et sur mobile.
- Le temps reel reprend sans doublon apres reconnexion.
- Les donnees sensibles sont absentes du DOM, des logs et du stockage navigateur.
- Une action critique exige les memes preuves et PIN que Telegram.

## Definition de termine

- Toutes les vues listees sont fonctionnelles avec donnees reelles, etats vides et erreurs.
- API, session, CSRF, temps reel, accessibilite et E2E sont valides.
- Guide d'utilisation locale et captures de reference ajoutes.
- Aucun critere ouvert ; `pnpm verify` et build production verts.

## Exclusions

- Pas d'exposition Internet ou LAN par defaut.
- Pas de multi-tenant ni gestion avancee de plusieurs utilisateurs.
- Pas de logique d'execution dans le frontend.

## Compte rendu

Phase achevée le 1er octobre 2026.

- Contrats DTO v1 centralisés dans `packages/web-contracts`, avec pagination bornée, tris
  allowlistés, validation runtime des mutations et erreurs structurées.
- API locale dans `apps/api` : session PIN courte et rotative, cookie strict, CSRF, contrôle
  Origin/Host/adresse distante, limites PIN/corps, en-têtes de sécurité, SSE à curseur, audit
  sanitise et refus de toute mutation hors port applicatif.
- Dashboard React dans `apps/web-dashboard` : thèmes clair/sombre, navigation desktop et 360 px,
  Overview, toutes les vues métier, diagnostic exportable, création de mission, approbation forte,
  états vides/erreurs, focus clavier et raccourcis `Alt+1` / `Alt+M`.
- Temps réel : reprise depuis le curseur, ordre, déduplication, détection de trou, resynchronisation
  et limite de taille d’événement.
- QA : tests de contrats, intégration HTTP, rotation de session, CSRF, contournement direct,
  fuite par canaris, écoute loopback, axe et 10 parcours E2E desktop/mobile.
- Guide local : `docs/development/dashboard-local.md`.
- Concepts et rendus : `docs/qa/phase-18/`.

### Registre de fidélité visuelle

| Élément     | Résultat                                                            | Écart accepté                                             |
| ----------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| Vue desktop | Structure, hiérarchie, palette et rail contextuel conformes         | Densité adaptée aux données de QA                         |
| Vue mobile  | Résumé santé, mission, navigation et action primaire conformes      | Timeline plus détaillée et continue sous le premier écran |
| Approbation | Empreinte, risque, avertissement, PIN focalisé et actions conformes | Dialogue légèrement plus compact                          |
| Style       | Surfaces unies, tokens et thèmes clair/sombre                       | Marque géométrique rendue en CSS                          |

Décision de QA visuelle : **agency-signoff accordé**. Aucun écart ne bloque l’usage, la sécurité,
l’accessibilité ou les actions critiques.

Le mode `?demo=1` reste explicitement réservé aux tests visuels. En fonctionnement normal, le
frontend utilise exclusivement l’API réelle ; le serveur autonome sans composition applicative
reste volontairement dégradé et refuse les mutations.
