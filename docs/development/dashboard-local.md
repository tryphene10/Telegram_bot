# Dashboard Web local

Le dashboard de la phase 18 est une interface strictement locale. Vite, sa prévisualisation et
l’API refusent une écoute réseau par défaut et utilisent `127.0.0.1`.

## Démarrage développeur

```powershell
corepack pnpm dev:api
corepack pnpm dev:web
```

Ouvrir ensuite `http://127.0.0.1:5173`. L’accès normal demande le PIN fourni par le port
`LocalPinPort`. Le mode visuel de démonstration est volontairement explicite et réservé à la QA :
`http://127.0.0.1:5173/?demo=1`.

Le processus hôte compose `createApiServer` avec trois ports :

- `DashboardApplicationPort`, qui projette les données réelles et transmet chaque mutation aux
  services applicatifs et au Policy Engine ;
- `LocalPinPort`, qui réutilise la validation PIN locale ;
- `HttpAuditPort`, qui écrit uniquement les métadonnées HTTP sanitisées.

Sans cette composition, le serveur autonome reste en mode sûr : listes vides, diagnostic dégradé
et mutations refusées. Il ne remplace jamais ce mode par des données de démonstration.

## Sécurité et exploitation

- Session courte en cookie `HttpOnly`, `SameSite=Strict`, avec rotation et preuve CSRF en mémoire.
- Vérification de l’origine, du host et de l’adresse distante ; écoute `0.0.0.0` refusée.
- CSP stricte, anti-framing, `nosniff`, politique de référent et permissions minimales.
- Les actions critiques repassent par le port applicatif après présentation de l’action exacte,
  de son empreinte et d’un nouveau PIN.
- Le diagnostic exportable ne contient que le DTO marqué `exportSafe`.

## Validation

```powershell
corepack pnpm --filter @arcc/web-dashboard test
corepack pnpm --filter @arcc/web-dashboard test:e2e
corepack pnpm verify
```

Les concepts et rendus de référence sont conservés dans `docs/qa/phase-18/`.
