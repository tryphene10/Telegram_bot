import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { EntityDto } from '@arcc/web-contracts';
import { Status } from './ApprovalDialog.js';
export function EntityView({
  title,
  description,
  items,
  action,
}: {
  title: string;
  description: string;
  items: readonly EntityDto[];
  action?: string;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase('fr');
    return items.filter((item) => item.name.toLocaleLowerCase('fr').includes(needle));
  }, [items, query]);
  return (
    <div className="entity-page">
      <section className="page-heading">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action ? <button className="primary-action">{action}</button> : null}
      </section>
      <section className="panel entity-panel">
        <div className="entity-toolbar">
          <label>
            <Search />
            <span className="sr-only">Rechercher</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Rechercher dans ${title.toLocaleLowerCase('fr')}…`}
            />
          </label>
          <span>{filtered.length} éléments</span>
        </div>
        {filtered.length ? (
          <div className="entity-list">
            {filtered.map((item) => (
              <button key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {Object.entries(item.summary)
                      .map(([key, value]) => `${key}: ${String(value)}`)
                      .join(' · ') || 'Projection sanitisee'}
                  </small>
                </div>
                <Status
                  tone={
                    item.tone === 'ERROR'
                      ? 'error'
                      : item.tone === 'WARNING'
                        ? 'warning'
                        : item.tone === 'OK'
                          ? 'ok'
                          : 'info'
                  }
                >
                  {item.status}
                </Status>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">Aucun résultat. Modifiez votre recherche.</div>
        )}
      </section>
    </div>
  );
}
