import { useEffect, useState } from 'react';
import brandMark from '../assets/logo-marca.png';
import Dashboard from '../pages/Dashboard';
import Training from '../pages/Training';
import Crosshair from '../pages/Crosshair';
import Modes from '../pages/Modes';
import Statistics from '../pages/Statistics';
import Customization from '../pages/Customization';
import Account from '../pages/Account';
import { openExternal } from '../services/system';
import { AUTHOR_NAME, PROJECT_URL } from '../config/project';
import './AppShell.css';

const NAV = [
  { id: 'dashboard', index: '01', label: 'Visão geral' },
  { id: 'training', index: '02', label: 'Treino' },
  { id: 'crosshair', index: '03', label: 'Crosshair' },
  { id: 'modes', index: '04', label: 'Modalidades' },
  { id: 'stats', index: '05', label: 'Estatísticas' },
  { id: 'custom', index: '06', label: 'Personalização' },
  { id: 'account', index: '07', label: 'Conta e sessão' }
];

const TITLES = {
  dashboard: 'Visão geral',
  training: 'Treino',
  crosshair: 'Crosshair',
  modes: 'Modalidades',
  stats: 'Estatísticas',
  custom: 'Personalização',
  account: 'Conta e sessão'
};

export default function AppShell({ session, version, onLogout }) {
  const [route, setRoute] = useState('dashboard');
  const [mode, setMode] = useState('clicking');

  useEffect(() => {
    const onKey = event => {
      if (!event.altKey) return;
      const item = NAV[Number(event.key) - 1];
      if (!item) return;
      event.preventDefault();
      setRoute(item.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function startMode(nextMode) {
    setMode(nextMode);
    setRoute('training');
  }

  const current = NAV.find(item => item.id === route);
  const display = session?.account?.display || session?.account?.email || 'conta verificada';

  function handleOpenSource() {
    void openExternal(PROJECT_URL);
  }

  return (
    <div className="shell">
      <aside className="shell__rail">
        <div className="shell__brand">
          <img src={brandMark} alt="" />
          <span>LAST TRAINING</span>
        </div>

        <div className="shell__nav-label">Aim lab / local</div>
        <nav className="shell__nav" aria-label="Navegação principal">
          {NAV.map(item => (
            <button
              key={item.id}
              type="button"
              className={`nav-item${route === item.id ? ' is-active' : ''}`}
              onClick={() => setRoute(item.id)}
              aria-current={route === item.id ? 'page' : undefined}
            >
              <span className="nav-item__index">{item.index}</span>
              <span className="nav-item__label">{item.label}</span>
              <span className="nav-item__mark" aria-hidden="true" />
            </button>
          ))}
        </nav>

        <div className="shell__rail-foot">
          <span>licença</span>
          <strong>{session?.license?.status || 'ativa'}</strong>
          <span className="shell__rail-version">v{version || '0.1.0'}</span>
        </div>
      </aside>

      <div className="shell__main">
        <header className="shell__topbar">
          <div className="shell__breadcrumb">
            <span>LT</span>
            <i aria-hidden="true" />
            <span>{TITLES[route]}</span>
          </div>
          <div className="shell__topbar-right">
            <button type="button" className="shell__github" onClick={handleOpenSource}>
              Open source · GitHub ↗
            </button>
            <span className="shell__account">{display}</span>
            <button type="button" className="shell__logout" onClick={onLogout}>
              Sair
            </button>
          </div>
        </header>

        <main className="shell__content" key={route}>
          {route === 'dashboard' && <Dashboard session={session} onNavigate={setRoute} onStart={startMode} />}
          {route === 'training' && (
            <Training mode={mode} onModeChange={setMode} onNavigate={setRoute} />
          )}
          {route === 'crosshair' && <Crosshair onStart={startMode} />}
          {route === 'modes' && <Modes onStart={startMode} />}
          {route === 'stats' && <Statistics />}
          {route === 'custom' && <Customization />}
          {route === 'account' && <Account session={session} version={version} onLogout={onLogout} />}
        </main>

        <footer className="shell__statusbar">
          <span>{current?.index} / 07</span>
          <span>engine local · 120 hz · zero rede</span>
          <span>criado por {AUTHOR_NAME}</span>
          <span>alt + 1–7</span>
        </footer>
      </div>
    </div>
  );
}
