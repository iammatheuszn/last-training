import { useCallback, useEffect, useState } from 'react';
import BootScreen from './pages/BootScreen';
import LoginPage from './pages/LoginPage';
import AppShell from './shell/AppShell';
import { appInfo, bootstrap, logout, refresh } from './services/auth';
import { migrateLegacy } from './services/stats';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export default function App() {
  const [phase, setPhase] = useState('booting');
  const [session, setSession] = useState(null);
  const [info, setInfo] = useState({ version: '', authConfigured: false });

  useEffect(() => {
    let alive = true;
    migrateLegacy().catch(() => {});
    Promise.all([bootstrap(), appInfo()])
      .then(([boot, meta]) => {
        if (!alive) return;
        setInfo(meta);
        if (boot?.data?.authenticated) {
          setSession(boot.data);
          setPhase('ready');
        } else {
          setPhase('locked');
        }
      })
      .catch(() => {
        if (alive) setPhase('locked');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'ready' || !session?.license) return undefined;
    const timer = setInterval(async () => {
      try {
        const result = await refresh();
        if (result?.ok && result.data?.authenticated) {
          setSession(result.data);
          return;
        }
        const code = result?.error?.code;
        if (code !== 'SERVER_UNAVAILABLE' && code !== 'NOT_CONFIGURED') {
          setSession(null);
          setPhase('locked');
        }
      } catch {
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [phase, session?.license]);

  const handleLogout = useCallback(async () => {
    await logout();
    setSession(null);
    setPhase('locked');
  }, []);

  if (phase === 'booting') return <BootScreen />;

  if (phase === 'ready') {
    return <AppShell session={session} version={info.version} onLogout={handleLogout} />;
  }

  return (
    <LoginPage
      version={info.version}
      authConfigured={info.authConfigured}
      onSuccess={data => {
        setSession(data);
        setPhase('ready');
      }}
    />
  );
}
