import { useCallback, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import type { ApprovalDto, EntityDto, OverviewDto } from '@arcc/web-contracts';
import { DashboardApiClient } from './api-client.js';
import { approval, entityFixtures, overviewFixture } from './demo-data.js';
import { ApprovalDialog } from './components/ApprovalDialog.js';
import { EntityView } from './components/EntityView.js';
import { DiagnosticView } from './components/DiagnosticView.js';
import { Overview } from './components/Overview.js';
import { Shell } from './components/Shell.js';
const client = new DashboardApiClient();
const routeData: Readonly<
  Record<
    string,
    { title: string; description: string; items: readonly EntityDto[]; action?: string }
  >
> = {
  machines: {
    title: 'Machines',
    description: 'État, capacités, dernière activité, appairage et révocation.',
    items: entityFixtures.machines ?? [],
    action: 'Appairer une machine',
  },
  projects: {
    title: 'Projets',
    description: 'Manifestes, stacks, commandes et état Git sanitise.',
    items: entityFixtures.projects ?? [],
    action: 'Ajouter un projet',
  },
  missions: {
    title: 'Missions',
    description: 'Création, progression, plans, preuves et contrôle d’exécution.',
    items: overviewFixture.missions,
    action: 'Nouvelle mission',
  },
  approvals: {
    title: 'Approbations',
    description: 'Actions exactes, risques, empreintes et expirations.',
    items: overviewFixture.approvals,
  },
  agents: {
    title: 'Agents',
    description: 'Modèles, budgets, itérations et outils autorisés.',
    items: entityFixtures.agents ?? [],
  },
  schedules: {
    title: 'Planifications',
    description: 'Prochaines occurrences, historique et motifs de blocage.',
    items: overviewFixture.schedules,
    action: 'Créer une planification',
  },
  incidents: {
    title: 'Incidents',
    description: 'Hystérésis, anti-flapping et actions proposées.',
    items: overviewFixture.incidents,
  },
  artifacts: {
    title: 'Artefacts',
    description: 'Classification, rétention et téléchargements autorisés.',
    items: entityFixtures.artifacts ?? [],
  },
  logs: {
    title: 'Journaux',
    description: 'Événements audités et projections sans contenu sensible.',
    items: entityFixtures.audit ?? [],
  },
  usage: {
    title: 'Utilisation',
    description: 'Tokens, latence et ressources locales sans contenu sensible.',
    items: overviewFixture.usage,
  },
  settings: {
    title: 'Paramètres',
    description: 'Fournisseurs, rétention, autonomie et préférences locales.',
    items: entityFixtures.models ?? [],
  },
  security: {
    title: 'Sécurité',
    description: 'Coffre, allowlists, sessions et audit append-only.',
    items: entityFixtures.users ?? [],
  },
};
export function App({ initialData }: { initialData?: OverviewDto } = {}) {
  const demo =
    initialData !== undefined || new URLSearchParams(globalThis.location?.search ?? '').has('demo');
  const [data, setData] = useState<OverviewDto | undefined>(
    initialData ?? (demo ? overviewFixture : undefined),
  );
  const [authError, setAuthError] = useState('');
  const [selectedApproval, setSelectedApproval] = useState<ApprovalDto>();
  const [newMission, setNewMission] = useState(false);
  const authenticate = useCallback(async (pin: string) => {
    try {
      await client.authenticate(pin);
      setData(await client.overview());
      setAuthError('');
    } catch {
      setAuthError('PIN refusé ou API locale indisponible.');
    }
  }, []);
  const approve = useCallback(
    async (pin: string) => {
      await client.authenticate(pin);
      await client.action({
        action: 'APPROVAL_APPROVE',
        targetId: selectedApproval?.id ?? approval.id,
        expectedState: 'WAITING_APPROVAL',
        actionHash: selectedApproval?.actionHash ?? approval.actionHash,
        authorizationReference: 'local-session',
      });
    },
    [selectedApproval],
  );
  const pages = useMemo(() => Object.entries(routeData), []);
  if (!data) return <Login onSubmit={authenticate} error={authError} />;
  return (
    <Shell onNewMission={() => setNewMission(true)}>
      <Routes>
        <Route path="/" element={<Overview data={data} onApproval={setSelectedApproval} />} />
        <Route
          path="/diagnostic"
          element={
            <DiagnosticView
              initial={
                demo
                  ? {
                      version: 'v1',
                      generatedAt: data.generatedAt,
                      correlationId: data.correlationId,
                      components: data.health,
                      degraded: false,
                      exportSafe: true,
                    }
                  : undefined
              }
            />
          }
        />
        {pages.map(([path, config]) => (
          <Route key={path} path={`/${path}`} element={<EntityView {...config} />} />
        ))}
      </Routes>
      {selectedApproval ? (
        <ApprovalDialog
          approval={selectedApproval}
          onClose={() => setSelectedApproval(undefined)}
          onSubmit={approve}
        />
      ) : null}
      {newMission ? (
        <NewMissionDialog
          onClose={() => setNewMission(false)}
          onSubmit={async (objective, model) => {
            await client.action({
              action: 'MISSION_CREATE',
              targetId: 'owner',
              expectedState: 'NEW',
              input: { objective, model },
            });
            setData(await client.overview());
          }}
        />
      ) : null}
    </Shell>
  );
}
function Login({ onSubmit, error }: { onSubmit: (pin: string) => Promise<void>; error: string }) {
  const [pin, setPin] = useState('');
  return (
    <main className="login-page">
      <form
        className="login-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(pin);
        }}
      >
        <span className="brand-mark">A</span>
        <h1>AI Remote Command Center</h1>
        <p>Ouvrez une session locale courte pour accéder au tableau de bord.</p>
        <label htmlFor="session-pin">PIN local</label>
        <input
          id="session-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          autoFocus
        />
        <div className="form-error" aria-live="assertive">
          {error}
        </div>
        <button className="primary-action">Ouvrir la session</button>
        <small>Connexion limitée à 127.0.0.1 · Aucun secret persistant</small>
      </form>
    </main>
  );
}
function NewMissionDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (objective: string, model: string) => Promise<void>;
}) {
  const [objective, setObjective] = useState('');
  const [model, setModel] = useState('LOCAL / mistral-7b-instruct-q4');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="dialog-backdrop">
      <form
        className="approval-dialog compact-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-title"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void onSubmit(objective, model)
            .then(onClose)
            .catch(() => setError('Création refusée ou service indisponible.'))
            .finally(() => setBusy(false));
        }}
      >
        <h2 id="mission-title">Nouvelle mission</h2>
        <p>La politique et le modèle exact seront vérifiés avant exécution.</p>
        <label htmlFor="objective">Objectif</label>
        <textarea
          id="objective"
          rows={4}
          required
          maxLength={4000}
          placeholder="Décrivez le résultat attendu…"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
        <label htmlFor="mission-model">Modèle exact</label>
        <select id="mission-model" value={model} onChange={(event) => setModel(event.target.value)}>
          <option>LOCAL / mistral-7b-instruct-q4</option>
        </select>
        <div className="form-error" aria-live="assertive">
          {error}
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Annuler
          </button>
          <button className="primary-action" disabled={busy}>
            {busy ? 'Création…' : 'Créer la mission'}
          </button>
        </div>
      </form>
    </div>
  );
}
