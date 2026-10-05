import { useState } from 'react';
import {
  Activity,
  ChevronRight,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  Server,
  ShieldCheck,
} from 'lucide-react';
import type { ApprovalDto, EntityDto, MissionDto, OverviewDto } from '@arcc/web-contracts';
import { Status } from './ApprovalDialog.js';
const tone = (value: EntityDto['tone']) =>
  value === 'OK'
    ? 'ok'
    : value === 'WARNING'
      ? 'warning'
      : value === 'ERROR'
        ? 'error'
        : value === 'BLOCKED'
          ? 'error'
          : 'info';
export function Overview({
  data,
  onApproval,
}: {
  data: OverviewDto;
  onApproval: (value: ApprovalDto) => void;
}) {
  const [selected, setSelected] = useState(data.missions[0]?.id);
  const mission = data.missions.find((item) => item.id === selected) ?? data.missions[0];
  return (
    <div className="overview">
      <section className="page-heading">
        <div>
          <h1>Vue d’ensemble</h1>
          <p>
            <span className="desktop-copy">
              État du système, missions en cours et activités récentes.
            </span>
            <span className="mobile-copy">
              Surveillance et pilotage de votre infrastructure IA.
            </span>
          </p>
        </div>
      </section>
      <div className="overview-grid">
        <div className="overview-main">
          <section className="panel health-panel">
            <header>
              <h2>État du système</h2>
              <span className="healthy">
                <i />
                Tous les services opérationnels
              </span>
              <small>Dernière vérification : maintenant</small>
            </header>
            <div className="mobile-health-summary">
              <strong>{data.health.length}</strong>
              <span>services opérationnels</span>
              <small>Tous les systèmes sont fonctionnels</small>
            </div>
            <div className="health-list">
              {data.health.map((item, index) => {
                const Icon = [Server, Database, Activity, Cpu][index] ?? Server;
                return (
                  <article key={item.id}>
                    <Icon />
                    <div>
                      <strong>{item.name}</strong>
                      <Status tone={tone(item.tone)}>{item.status}</Status>
                    </div>
                    <small>{Object.values(item.summary).join(' · ')}</small>
                  </article>
                );
              })}
            </div>
          </section>
          <section className="panel missions-panel">
            <header>
              <h2>
                Missions actives <span>{data.missions.length}</span>
              </h2>
              <input
                type="search"
                aria-label="Rechercher une mission"
                placeholder="Rechercher une mission…"
              />
            </header>
            <div className="mission-table" role="group" aria-label="Missions actives">
              <div className="table-head" aria-hidden="true">
                <span>Nom</span>
                <span>Machine</span>
                <span>Progression</span>
                <span>Statut</span>
                <span>Modèle</span>
              </div>
              {data.missions.map((item) => (
                <button
                  className={item.id === selected ? 'selected' : ''}
                  key={item.id}
                  onClick={() => setSelected(item.id)}
                >
                  <span>{item.name}</span>
                  <span>{item.machine}</span>
                  <span className="progress-cell">
                    <i style={{ width: `${item.progress}%` }} />
                    <em>{item.progress} %</em>
                  </span>
                  <span>
                    <Status tone={item.status === 'En cours' ? 'info' : 'neutral'}>
                      {item.status}
                    </Status>
                  </span>
                  <span>{item.model}</span>
                  <ChevronRight />
                </button>
              ))}
            </div>
            {mission ? <MissionDetail mission={mission} /> : <Empty text="Aucune mission active" />}
          </section>
          <section className="panel usage-panel">
            <header>
              <h2>Utilisation des ressources</h2>
            </header>
            <div className="usage-list">
              {data.usage.map((item, index) => {
                const Icon = [Cpu, MemoryStick, HardDrive, ShieldCheck][index] ?? Cpu;
                return (
                  <article key={item.id}>
                    <Icon />
                    <div>
                      <span>{item.name}</span>
                      <strong>{item.status}</strong>
                      <i>
                        <b style={{ width: `${Number(item.summary.valeur ?? 0)}%` }} />
                      </i>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
        <aside className="context-rail">
          <Rail title="Approbations en attente" count={data.approvals.length}>
            {data.approvals.map((item) => (
              <button className="rail-row" key={item.id} onClick={() => onApproval(item)}>
                <div>
                  <strong>{item.action}</strong>
                  <small>{item.project} · expire bientôt</small>
                </div>
                <Status tone="warning">{item.risk}</Status>
                <ChevronRight />
              </button>
            ))}
          </Rail>
          <Rail title="Incidents ouverts" count={data.incidents.length}>
            {data.incidents.map((item) => (
              <div className="rail-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>{String(item.summary.ouvert)}</small>
                </div>
                <Status tone={tone(item.tone)}>{item.status}</Status>
              </div>
            ))}
          </Rail>
          <Rail title="Planifications" count={data.schedules.length}>
            {data.schedules.map((item) => (
              <div className="rail-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>{String(item.summary.prochaine)}</small>
                </div>
                <Status>{item.status}</Status>
              </div>
            ))}
          </Rail>
          <Rail title="Activité récente">
            {data.activity.map((item) => (
              <div className="activity-row" key={item.id}>
                <time>{item.occurredAt}</time>
                <i />
                <span>{item.title}</span>
              </div>
            ))}
          </Rail>
        </aside>
      </div>
    </div>
  );
}
function MissionDetail({ mission }: { mission: MissionDto }) {
  return (
    <div className="mission-detail">
      <div className="mission-meta">
        <h3>{mission.name}</h3>
        <Status>
          {mission.status} · {mission.progress} %
        </Status>
        <dl>
          <dt>ID</dt>
          <dd>
            <code>{mission.id}</code>
          </dd>
          <dt>Projet</dt>
          <dd>{mission.project}</dd>
          <dt>Machine</dt>
          <dd>{mission.machine}</dd>
          <dt>Modèle</dt>
          <dd>{mission.model}</dd>
        </dl>
      </div>
      <ol className="timeline">
        {mission.timeline.map((event) => (
          <li key={event.id} className={event.status.toLowerCase()}>
            <i />
            <div>
              <strong>{event.title}</strong>
              <span>{event.status}</span>
            </div>
            <time>{event.occurredAt}</time>
          </li>
        ))}
      </ol>
    </div>
  );
}
function Rail({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="panel rail-panel">
      <header>
        <h2>
          {title}
          {count !== undefined ? <span>{count}</span> : null}
        </h2>
        <button>Tout voir</button>
      </header>
      {children}
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
