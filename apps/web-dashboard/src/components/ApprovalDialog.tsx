import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Copy, X } from 'lucide-react';
import type { ApprovalDto } from '@arcc/web-contracts';
export function ApprovalDialog({
  approval,
  onClose,
  onSubmit,
}: {
  approval: ApprovalDto;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pin.length < 4) {
      setError('Saisissez votre PIN local.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(pin);
      onClose();
    } catch {
      setError('PIN incorrect ou demande expirée. Réévaluation requise.');
      setBusy(false);
    }
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
      >
        <button className="dialog-close icon-button" onClick={onClose} aria-label="Fermer">
          <X />
        </button>
        <div className="dialog-heading">
          <div>
            <h2 id="approval-title">Approbation forte requise</h2>
            <p>
              Expire dans <strong>04:32</strong>
            </p>
          </div>
          <span>Échap pour fermer</span>
        </div>
        <dl className="approval-details">
          <dt>Action</dt>
          <dd>{approval.action}</dd>
          <dt>Projet</dt>
          <dd>{approval.project}</dd>
          <dt>Machine</dt>
          <dd>{approval.machine}</dd>
          <dt>Environnement</dt>
          <dd>{approval.environment}</dd>
          <dt>Modèle exact</dt>
          <dd>{approval.model}</dd>
          <dt>Risque</dt>
          <dd>
            <Status tone="error">ÉLEVÉ</Status>
          </dd>
          <dt>Paramètres</dt>
          <dd>service: postgresql · délai: 30 s</dd>
          <dt>Empreinte de l’action</dt>
          <dd className="fingerprint">
            <code>{approval.actionHash}</code>
            <button aria-label="Copier l’empreinte">
              <Copy />
            </button>
          </dd>
        </dl>
        <div className="approval-warning">
          <AlertTriangle />
          <span>
            Cette autorisation est valable une seule fois et sera réévaluée avant exécution.
          </span>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="local-pin">PIN local</label>
          <input
            ref={input}
            id="local-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            aria-describedby="pin-error"
          />
          <div id="pin-error" className="form-error" aria-live="assertive">
            {error}
          </div>
          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Refuser
            </button>
            <button className="danger-button" disabled={busy}>
              {busy ? 'Vérification…' : 'Autoriser une fois'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
export function Status({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'ok' | 'info' | 'warning' | 'error' | 'neutral';
}) {
  return <span className={`status status-${tone}`}>{children}</span>;
}
