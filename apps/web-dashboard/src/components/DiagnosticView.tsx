import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { DiagnosticDto } from '@arcc/web-contracts';
import { DashboardApiClient } from '../api-client.js';
import { Status } from './ApprovalDialog.js';

export function DiagnosticView({ initial }: { initial?: DiagnosticDto | undefined }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initial);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await new DashboardApiClient().diagnostic());
    } catch {
      setError('Diagnostic indisponible. Vérifiez que l’API locale est démarrée.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initial) void refresh();
  }, [initial]);

  const download = () => {
    if (!data?.exportSafe) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arcc-diagnostic-${data.generatedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="entity-page">
      <header className="page-heading">
        <div>
          <h1>Diagnostic</h1>
          <p>État sanitise des composants locaux, sans secret ni contenu de mission.</p>
        </div>
        <button className="primary-action" onClick={download} disabled={!data?.exportSafe}>
          <Download /> Exporter
        </button>
      </header>
      <div className="panel">
        <div className="entity-toolbar">
          <span aria-live="polite">
            {loading ? 'Chargement…' : error || `Corrélation ${data?.correlationId ?? '—'}`}
          </span>
          <button className="secondary-button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw /> Actualiser
          </button>
        </div>
        <div className="entity-list">
          {data?.components.map((component) => (
            <button key={component.id} type="button">
              <div>
                <strong>{component.name}</strong>
                <small>{Object.values(component.summary).join(' · ')}</small>
              </div>
              <Status tone={component.tone === 'OK' ? 'ok' : 'warning'}>{component.status}</Status>
            </button>
          ))}
          {!loading && !error && !data?.components.length ? (
            <div className="empty-state">Aucun composant déclaré.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
