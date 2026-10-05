import type {
  ApprovalDto,
  EntityDto,
  MissionDto,
  OverviewDto,
  StatusTone,
  TimelineEventDto,
} from '@arcc/web-contracts';
const at = '2026-10-01T14:27:00.000+01:00';
const entity = (
  id: string,
  kind: EntityDto['kind'],
  name: string,
  status: string,
  tone: StatusTone,
  summary: EntityDto['summary'] = {},
): EntityDto => ({ id, kind, name, status, tone, summary, updatedAt: at });
const timeline: readonly TimelineEventDto[] = [
  {
    id: 'e1',
    sequence: 1,
    type: 'STEP',
    title: 'Initialisation',
    status: 'COMPLETED',
    occurredAt: '14:12',
  },
  {
    id: 'e2',
    sequence: 2,
    type: 'STEP',
    title: 'Collecte des informations',
    status: 'COMPLETED',
    occurredAt: '14:13',
  },
  {
    id: 'e3',
    sequence: 3,
    type: 'STEP',
    title: 'Analyse des configurations',
    status: 'RUNNING',
    occurredAt: '14:16',
  },
  {
    id: 'e4',
    sequence: 4,
    type: 'STEP',
    title: 'Rédaction du rapport',
    status: 'PENDING',
    occurredAt: '—',
  },
];
const mission = (
  id: string,
  name: string,
  progress: number,
  status = 'En cours',
  model = 'mistral-7b-instruct-q4',
): MissionDto => ({
  ...entity(id, 'missions', name, status, status === 'En cours' ? 'INFO' : 'NEUTRAL'),
  kind: 'missions',
  project: 'Command Center',
  machine: 'PC-DEV-01',
  model,
  progress,
  timeline,
});
const approval: ApprovalDto = {
  ...entity('approval-1', 'approvals', 'Redémarrage planifié', 'WAITING_APPROVAL', 'WARNING'),
  kind: 'approvals',
  action: 'Redémarrer le service PostgreSQL',
  project: 'Command Center',
  machine: 'PC-DEV-01',
  environment: 'LOCAL',
  model: 'mistral-7b-instruct-q4',
  risk: 'HIGH',
  actionHash: 'sha256: 7c81…a94e',
  parameters: { service: 'postgresql', délai: '30 s' },
  expiresAt: '2026-10-01T15:32:00+01:00',
};
export const overviewFixture: OverviewDto = {
  version: 'v1',
  generatedAt: at,
  correlationId: 'qa-local',
  health: [
    entity('api', 'agents', 'API', 'Opérationnel', 'OK', { version: 'v1.4.2', latence: '12 ms' }),
    entity('postgres', 'agents', 'PostgreSQL', 'Opérationnel', 'OK', {
      version: 'v15.5',
      latence: '8 ms',
    }),
    entity('windows', 'machines', 'Agent Windows', 'Connecté', 'OK', { machines: '3 / 3' }),
    entity('model', 'models', 'Modèle local', 'Disponible', 'OK', {
      modèle: 'mistral-7b-instruct-q4',
      latence: '1,2 s',
    }),
  ],
  missions: [
    mission('mission-1', 'Audit sécurité poste', 68),
    mission('mission-2', 'Mise à jour applications', 22),
    mission('mission-3', 'Collecte journaux système', 90),
    mission('mission-4', 'Analyse performance', 0, 'En attente'),
  ],
  approvals: [approval],
  incidents: [
    entity('incident-1', 'incidents', 'Agent hors ligne sur PC-SRV-02', 'CRITIQUE', 'ERROR', {
      ouvert: 'il y a 29 min',
    }),
    entity('incident-2', 'incidents', 'Échec de mise à jour Windows', 'MAJEUR', 'WARNING', {
      ouvert: 'il y a 3 h 4 min',
    }),
  ],
  schedules: [
    entity('schedule-1', 'schedules', 'Sauvegarde configurations', 'Planifiée', 'INFO', {
      prochaine: 'Aujourd’hui 23:00',
    }),
    entity('schedule-2', 'schedules', 'Collecte journaux', 'Planifiée', 'INFO', {
      prochaine: 'Demain 08:00',
    }),
  ],
  usage: [
    entity('cpu', 'usage', 'CPU', '24 %', 'OK', { valeur: 24 }),
    entity('ram', 'usage', 'RAM', '6,1 / 16 Go', 'INFO', { valeur: 38 }),
    entity('disk', 'usage', 'Disque', '142 / 476 Go', 'INFO', { valeur: 30 }),
    entity('tokens', 'usage', 'Tokens locaux', '18,4 k / 128 k', 'INFO', { valeur: 14 }),
  ],
  activity: [
    {
      id: 'a1',
      sequence: 1,
      type: 'MACHINE',
      title: 'Agent PC-DEV-01 reconnecté',
      status: 'OK',
      occurredAt: '14:27',
    },
    {
      id: 'a2',
      sequence: 2,
      type: 'MISSION',
      title: 'Mission « Analyse performance » créée',
      status: 'INFO',
      occurredAt: '14:20',
    },
    {
      id: 'a3',
      sequence: 3,
      type: 'INCIDENT',
      title: 'Incident ouvert : Agent hors ligne',
      status: 'ERROR',
      occurredAt: '13:58',
    },
  ],
};
export const entityFixtures: Readonly<Record<string, readonly EntityDto[]>> = {
  machines: [
    entity('pc1', 'machines', 'PC-DEV-01', 'ONLINE', 'OK', {
      capacités: 'Terminal · Git · Docker · UIA',
      activité: 'il y a 12 s',
    }),
    entity('pc2', 'machines', 'PC-BUREAU-02', 'ONLINE', 'OK', {
      capacités: 'Terminal · Navigateur',
      activité: 'il y a 34 s',
    }),
    entity('pc3', 'machines', 'PC-SRV-02', 'OFFLINE', 'ERROR', {
      capacités: 'Services · Docker',
      activité: 'il y a 29 min',
    }),
  ],
  projects: [
    entity('p1', 'projects', 'Command Center', 'ACTIVE', 'OK', {
      stack: 'TypeScript · PostgreSQL',
      git: 'propre',
      racine: 'telegram_bot/',
    }),
    entity('p2', 'projects', 'Worker local', 'ACTIVE', 'OK', {
      stack: 'Node.js',
      git: '2 modifications',
      racine: 'worker/',
    }),
  ],
  agents: [
    entity('ag1', 'agents', 'Supervisor', 'READY', 'OK', {
      modèle: 'mistral-7b-instruct-q4',
      budget: '48 %',
      outils: 'Lecture · Planification',
    }),
    entity('ag2', 'agents', 'Security Reviewer', 'IDLE', 'NEUTRAL', {
      modèle: 'mistral-7b-instruct-q4',
      budget: '12 %',
      outils: 'Audit · Vérification',
    }),
  ],
  artifacts: [
    entity('ar1', 'artifacts', 'Rapport sécurité poste', 'LOCAL_ONLY', 'INFO', {
      type: 'PDF',
      rétention: '30 jours',
      taille: '1,2 Mo',
    }),
  ],
  audit: [
    entity('au1', 'audit', 'MISSION_STARTED', 'AUDITED', 'OK', {
      corrélation: '84ce…11ad',
      acteur: 'Rufus',
    }),
  ],
  models: [
    entity('mo1', 'models', 'mistral-7b-instruct-q4', 'AVAILABLE', 'OK', {
      destination: 'LOCAL_MODEL',
      contexte: '128 k',
    }),
  ],
  users: [entity('u1', 'users', 'Rufus', 'ACTIVE', 'OK', { rôle: 'OWNER' })],
};
export { approval };
