import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bot,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  CircleUserRound,
  ClipboardList,
  FileClock,
  Folder,
  Home,
  Menu,
  Moon,
  Monitor,
  Plus,
  Settings,
  ShieldCheck,
  Stethoscope,
  Sun,
  X,
} from 'lucide-react';
const navigation = [
  ['/', 'Vue d’ensemble', Home],
  ['/machines', 'Machines', Monitor],
  ['/projects', 'Projets', Folder],
  ['/missions', 'Missions', ClipboardList],
  ['/approvals', 'Approbations', CheckSquare],
  ['/agents', 'Agents', Bot],
  ['/schedules', 'Planifications', CalendarDays],
  ['/incidents', 'Incidents', AlertTriangle],
  ['/artifacts', 'Artefacts', Archive],
  ['/logs', 'Journaux', FileClock],
  ['/usage', 'Utilisation', BarChart3],
  ['/settings', 'Paramètres', Settings],
  ['/security', 'Sécurité', ShieldCheck],
  ['/diagnostic', 'Diagnostic', Stethoscope],
] as const;
export function Shell({
  children,
  onNewMission,
}: {
  children: ReactNode;
  onNewMission: () => void;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === '1') {
        event.preventDefault();
        navigate('/');
      }
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        navigate('/missions');
      }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [navigate]);
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="mobile-menu icon-button"
          aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X /> : <Menu />}
        </button>
        <a href="/" className="brand">
          <span className="brand-mark">A</span>
          <strong>ARCC</strong>
          <span>AI Remote Command Center</span>
        </a>
        <div className="topbar-actions">
          <span className="mode">
            <ShieldCheck />
            Mode EXECUTE_SAFE
          </span>
          <span className="local">
            <i />
            Local · 127.0.0.1
          </span>
          <button
            className="icon-button theme-button"
            aria-label={theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre'}
            onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <button className="user-button">
            <CircleUserRound />
            Rufus
            <ChevronDown />
          </button>
          <button className="primary-action" onClick={onNewMission}>
            <Plus />
            Nouvelle mission
          </button>
        </div>
      </header>
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Navigation principale">
        <nav>
          {navigation.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="workspace">{children}</main>
      <nav className="mobile-nav" aria-label="Navigation mobile">
        {[navigation[0], navigation[3], navigation[7]].map(([to, label, Icon]) => (
          <NavLink key={to} to={to} end={to === '/'}>
            <Icon />
            <span>{to === '/' ? 'Accueil' : to === '/incidents' ? 'Alertes' : label}</span>
          </NavLink>
        ))}
        <button onClick={() => setOpen(true)}>
          <Menu />
          <span>Plus</span>
        </button>
      </nav>
    </div>
  );
}
