import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError, clearToken, setToken } from './api';
import { AUTHOR_NAME, PROJECT_URL } from './project';
import FluxLines from './components/FluxLines';
import { Empty, Metric, Pill, TableHead, formatDate, fromLocalInput, toLocalInput } from './components/ui';
import type {
  Account,
  AdminSession,
  AuditRow,
  DeviceRow,
  LicenseStatus,
  RevokeResult,
  SessionRow
} from './types';

type Tab = 'overview' | 'accounts' | 'devices' | 'sessions' | 'audit' | 'system';

const TABS = [
  { id: 'overview', label: 'Visão geral', hint: 'leitura' },
  { id: 'accounts', label: 'Contas', hint: 'licenças' },
  { id: 'devices', label: 'Dispositivos', hint: 'acesso' },
  { id: 'sessions', label: 'Sessões', hint: 'revogar' },
  { id: 'audit', label: 'Auditoria', hint: 'eventos' },
  { id: 'system', label: 'Sistema', hint: 'fronteira' }
] as const;

const LICENSE_STATUSES: LicenseStatus[] = [
  'active',
  'expired',
  'suspended',
  'canceled',
  'blocked'
];

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Falha na solicitação administrativa.';
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

interface AccountDetailProps {
  account: Account;
  devices: DeviceRow[];
  busy: boolean;
  onLicense: (payload: {
    plan: string;
    status: LicenseStatus;
    expiresAt: string | null;
    features: string[];
  }) => Promise<void>;
  onStatus: (status: 'active' | 'blocked') => Promise<void>;
  onPassword: (password: string) => Promise<void>;
  onRevokeSessions: () => Promise<void>;
  onRevokeDevice: (deviceId: string) => Promise<void>;
}

function AccountDetail({
  account,
  devices,
  busy,
  onLicense,
  onStatus,
  onPassword,
  onRevokeSessions,
  onRevokeDevice
}: AccountDetailProps) {
  const [plan, setPlan] = useState(account.license.plan);
  const [status, setStatus] = useState<LicenseStatus>(account.license.status);
  const [expiresAt, setExpiresAt] = useState(toLocalInput(account.license.expiresAt));
  const [features, setFeatures] = useState(account.license.features.join(', '));
  const [accountStatus, setAccountStatus] = useState<'active' | 'blocked'>(account.status);
  const [password, setPassword] = useState('');
  const primaryDevice = devices.find(device => !device.revoked) || devices[0] || null;

  function submitLicense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onLicense({
      plan,
      status,
      expiresAt: fromLocalInput(expiresAt),
      features: features.split(',').map(item => item.trim()).filter(Boolean)
    });
  }

  function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onStatus(accountStatus);
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onPassword(password);
    setPassword('');
  }

  return (
    <section className="detail card" aria-label={`Detalhes de ${account.display}`}>
      <header className="detail__head">
        <div>
          <p className="eyebrow">Conta selecionada</p>
          <h2>{account.display}</h2>
          <p className="detail__id">{account.email} · {account.id}</p>
        </div>
        <div className="detail__pills">
          <Pill label={account.status} good={account.status === 'active'} />
          <Pill label={account.role} good={account.role !== 'admin'} />
        </div>
      </header>

      <div className="detail__stats">
        <Metric label="Plano" value={account.license.plan} />
        <Metric label="Licença" value={<Pill label={account.license.status} good={account.license.status === 'active'} />} />
        <Metric label="Dispositivos" value={String(account.devices)} />
        <Metric label="Sessões" value={String(account.sessions)} />
        <Metric
          label="Último IP"
          value={<span className="metric__code">{primaryDevice?.ip || '—'}</span>}
          hint="registrado no login"
        />
        <Metric
          label="HWID"
          value={<span className="metric__code">{primaryDevice?.hwid || '—'}</span>}
          hint={primaryDevice ? primaryDevice.name : 'sem dispositivo'}
        />
      </div>

      <form className="editor" onSubmit={submitLicense}>
        <div className="editor__head"><span>Licença</span><span>server-side</span></div>
        <div className="editor__grid">
          <label className="field">
            <span>Plano</span>
            <select value={plan} onChange={event => setPlan(event.target.value)}>
              <option value="free">free</option>
              <option value="pro">pro</option>
              <option value="team">team</option>
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={event => setStatus(event.target.value as LicenseStatus)}>
              {LICENSE_STATUSES.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Expiração</span>
            <input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} />
          </label>
          <label className="field">
            <span>Recursos</span>
            <input
              type="text"
              maxLength={1024}
              value={features}
              onChange={event => setFeatures(event.target.value)}
              placeholder="tracking, clicking, flick"
            />
          </label>
        </div>
        <button className="button button--primary" type="submit" disabled={busy}>Salvar licença</button>
      </form>

      <div className="detail__row">
        <form className="editor editor--compact" onSubmit={submitStatus}>
          <div className="editor__head"><span>Status da conta</span><span>acesso</span></div>
          <label className="field">
            <span>Status</span>
            <select value={accountStatus} onChange={event => setAccountStatus(event.target.value as 'active' | 'blocked')}>
              <option value="active">active</option>
              <option value="blocked">blocked</option>
            </select>
          </label>
          <button className="button" type="submit" disabled={busy}>Aplicar status</button>
        </form>

        <form className="editor editor--compact" onSubmit={submitPassword}>
          <div className="editor__head"><span>Redefinir senha</span><span>revoga sessões</span></div>
          <label className="field">
            <span>Nova senha</span>
            <input
              type="password"
              minLength={10}
              maxLength={256}
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </label>
          <button className="button button--danger" type="submit" disabled={busy}>Redefinir senha</button>
        </form>
      </div>

      <div className="editor">
        <div className="editor__head"><span>Dispositivos da conta</span><span>{devices.length} registro(s)</span></div>
        {devices.length ? (
          <div className="device-list">
            {devices.map(device => (
              <div className="device-row" key={device.id}>
                <div>
                  <strong>{device.name}</strong>
                  <small>IP {device.ip || '—'} · HWID {device.hwid || '—'} · {formatDate(device.lastSeen)}</small>
                  <small>{device.id}</small>
                </div>
                <button
                  className="button button--small button--danger"
                  type="button"
                  disabled={busy || device.revoked}
                  onClick={() => void onRevokeDevice(device.id)}
                >
                  {device.revoked ? 'Revogado' : 'Revogar'}
                </button>
              </div>
            ))}
          </div>
        ) : <Empty>Nenhum dispositivo registrado.</Empty>}
      </div>

      <button className="button button--danger" type="button" disabled={busy} onClick={() => void onRevokeSessions()}>
        Revogar todas as sessões
      </button>
    </section>
  );
}

interface CreateDialogProps {
  busy: boolean;
  onClose: () => void;
  onCreate: (payload: {
    email: string;
    display: string;
    password: string;
    plan: string;
    status: LicenseStatus;
    expiresAt: string | null;
    features: string[];
  }) => Promise<void>;
}

function CreateDialog({ busy, onClose, onCreate }: CreateDialogProps) {
  const [email, setEmail] = useState('');
  const [display, setDisplay] = useState('');
  const [password, setPassword] = useState('');
  const [plan, setPlan] = useState('pro');
  const [status, setStatus] = useState<LicenseStatus>('active');
  const [expiresAt, setExpiresAt] = useState('');
  const [features, setFeatures] = useState(
    'tracking, clicking, flick, switching, precision, speed, crosshair_follow, crosshair_stability, crosshair_grid'
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onCreate({
      email,
      display,
      password,
      plan,
      status,
      expiresAt: fromLocalInput(expiresAt),
      features: features.split(',').map(item => item.trim()).filter(Boolean)
    });
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Criar conta">
      <form className="modal__card card" onSubmit={submit}>
        <header>
          <div>
            <p className="eyebrow">Servidor</p>
            <h2>Nova conta</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="modal__grid">
          <label className="field">
            <span>E-mail</span>
            <input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span>Nome de exibição</span>
            <input type="text" required minLength={2} maxLength={80} value={display} onChange={event => setDisplay(event.target.value)} />
          </label>
          <label className="field">
            <span>Senha</span>
            <input type="password" required minLength={10} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} />
          </label>
          <label className="field">
            <span>Plano</span>
            <select value={plan} onChange={event => setPlan(event.target.value)}>
              <option value="free">free</option>
              <option value="pro">pro</option>
              <option value="team">team</option>
            </select>
          </label>
          <label className="field">
            <span>Status da licença</span>
            <select value={status} onChange={event => setStatus(event.target.value as LicenseStatus)}>
              {LICENSE_STATUSES.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Expiração</span>
            <input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} />
          </label>
          <label className="field field--wide">
            <span>Recursos</span>
            <input type="text" maxLength={1024} value={features} onChange={event => setFeatures(event.target.value)} />
          </label>
        </div>
        <footer>
          <button className="button" type="button" onClick={onClose}>Cancelar</button>
          <button className="button button--primary" type="submit" disabled={busy}>Criar no servidor</button>
        </footer>
      </form>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [detailDevices, setDetailDevices] = useState<DeviceRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditLimit, setAuditLimit] = useState('50');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [toast, setToast] = useState('');
  const [remaining, setRemaining] = useState(0);

  const notify = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(current => (current === text ? '' : current)), 5200);
  }, []);

  const logout = useCallback((text?: string) => {
    clearToken();
    setSession(null);
    setAccounts([]);
    setDevices([]);
    setDetailDevices([]);
    setSessions([]);
    setAudit([]);
    setSelectedId('');
    setIdentity('');
    setPassword('');
    setTab('overview');
    if (text) notify(text);
  }, [notify]);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      logout('Sessão administrativa encerrada. Entre novamente.');
      return;
    }
    notify(messageOf(error));
  }, [logout, notify]);

  const run = useCallback(async (task: () => Promise<void>, success?: string) => {
    setBusy(true);
    try {
      await task();
      if (success) notify(success);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [handleError, notify]);

  useEffect(() => {
    if (!session) return undefined;
    let active = true;
    (async () => {
      try {
        const [accountRows, deviceRows, sessionRows, auditRows] = await Promise.all([
          api<Account[]>('/v1/admin/accounts'),
          api<DeviceRow[]>('/v1/admin/devices', {}),
          api<SessionRow[]>('/v1/admin/sessions', {}),
          api<AuditRow[]>('/v1/admin/audit', { limit: 50 })
        ]);
        if (!active) return;
        setAccounts(accountRows);
        setDevices(deviceRows);
        setSessions(sessionRows);
        setAudit(auditRows);
      } catch (error) {
        if (active) handleError(error);
      }
    })();
    return () => { active = false; };
  }, [session, handleError]);

  useEffect(() => {
    if (accounts.length && !accounts.some(account => account.id === selectedId)) {
      setSelectedId(accounts[0].id);
    }
  }, [accounts, selectedId]);

  const selected = useMemo(
    () => accounts.find(account => account.id === selectedId) || null,
    [accounts, selectedId]
  );

  useEffect(() => {
    if (!selected || tab !== 'accounts') return undefined;
    let active = true;
    (async () => {
      try {
        const rows = await api<DeviceRow[]>('/v1/admin/devices', { accountId: selected.id });
        if (active) setDetailDevices(rows);
      } catch (error) {
        if (active) handleError(error);
      }
    })();
    return () => { active = false; };
  }, [selected, tab, handleError]);

  useEffect(() => {
    if (!session) return undefined;
    const tick = () => {
      const value = session.expiresAt - Date.now();
      setRemaining(value);
      if (value <= 0) logout('Sessão administrativa expirada. Entre novamente.');
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session, logout]);

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    (async () => {
      try {
        const data = await api<AdminSession>('/v1/admin/login', {
          identity,
          password
        }, false);
        setToken(data.token);
        setSession(data);
        setPassword('');
      } catch (error) {
        setAuthError(messageOf(error));
      } finally {
        setAuthBusy(false);
      }
    })();
  }

  async function refreshAccounts() {
    setAccounts(await api<Account[]>('/v1/admin/accounts'));
  }

  async function refreshDevices() {
    setDevices(await api<DeviceRow[]>('/v1/admin/devices', {}));
  }

  async function refreshDetail(accountId: string) {
    setDetailDevices(await api<DeviceRow[]>('/v1/admin/devices', { accountId }));
  }

  async function refreshAudit(limit = auditLimit) {
    setAudit(await api<AuditRow[]>('/v1/admin/audit', { limit: Number(limit) }));
  }

  const filteredAccounts = accounts.filter(account => {
    const needle = query.trim().toLowerCase();
    return !needle || account.email.toLowerCase().includes(needle) || account.display.toLowerCase().includes(needle);
  });

  const activeLicenses = accounts.filter(account => account.license.status === 'active').length;
  const blockedAccounts = accounts.filter(account => account.status === 'blocked').length;
  const activeDevices = devices.filter(device => !device.revoked).length;
  const activeSessions = sessions.filter(item => !item.revoked && Date.parse(item.expiresAt) > Date.now()).length;

  if (!session) {
    return (
      <main className="login-screen">
        <div className="login-screen__flux"><FluxLines /></div>
        <section className="login-card card">
          <img className="brand__logo" src="/admin/logo.png" alt="Símbolo Last Training" />
          <p className="eyebrow">Acesso restrito</p>
          <h1>Painel administrativo</h1>
          <p className="lede">Contas, licenças, dispositivos e auditoria são decididos no servidor. Esta página apenas opera a interface.</p>
          <form onSubmit={login}>
            <label className="field">
              <span>E-mail ou usuário</span>
              <input
                type="text"
                required
                autoComplete="username"
                maxLength={254}
                value={identity}
                onChange={event => { setIdentity(event.target.value); setAuthError(''); }}
              />
            </label>
            <label className="field">
              <span>Senha</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                maxLength={256}
                value={password}
                onChange={event => { setPassword(event.target.value); setAuthError(''); }}
              />
            </label>
            <button className="button button--primary button--full" type="submit" disabled={authBusy}>
              {authBusy ? 'Validando...' : 'Entrar'}
            </button>
            <div className="form-error" role="alert">{authError}</div>
          </form>
          <p className="login-card__foot">Token em memória · sem refresh · sessão curta · origem verificada</p>
          <p className="project-credit">
            Criado por {AUTHOR_NAME} · <a href={PROJECT_URL} target="_blank" rel="noreferrer">Open source no GitHub ↗</a>
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <img className="brand__logo" src="/admin/logo.png" alt="Símbolo Last Training" />
          <div>
            <strong>LAST TRAINING</strong>
            <span>administração</span>
          </div>
        </div>
        <nav className="rail__nav" aria-label="Seções administrativas">
          {TABS.map(item => (
            <button
              key={item.id}
              className={`rail__item${tab === item.id ? ' is-active' : ''}`}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>
        <div className="rail__foot">
          <span>server owns</span>
          <strong>auth · license · audit</strong>
          <span className="rail__credit">{AUTHOR_NAME}</span>
          <a className="rail__github" href={PROJECT_URL} target="_blank" rel="noreferrer">Open source · GitHub ↗</a>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Sessão administrativa</p>
            <h1>{TABS.find(item => item.id === tab)?.label}</h1>
          </div>
          <div className="topbar__session">
            <div>
              <strong>{session.account.display}</strong>
              <span>{session.account.email}</span>
            </div>
            <div className="session-clock">
              <span>{clock(remaining)}</span>
              <progress max={900} value={Math.min(900, Math.max(0, remaining / 1000))} />
            </div>
            <button className="button button--small" type="button" onClick={() => logout('Sessão encerrada.')}>Sair</button>
          </div>
        </header>

        <main className="content">
          {tab === 'overview' && (
            <div className="stack">
              <div className="metrics">
                <Metric label="Contas" value={String(accounts.length)} hint="registros no servidor" />
                <Metric label="Licenças ativas" value={String(activeLicenses)} hint="podem entrar no app" />
                <Metric label="Dispositivos ativos" value={String(activeDevices)} hint="não revogados" />
                <Metric label="Sessões ativas" value={String(activeSessions)} hint="access + refresh" />
                <Metric label="Contas bloqueadas" value={String(blockedAccounts)} hint="acesso negado" />
              </div>

              <div className="columns">
                <section className="card">
                  <div className="card__head">
                    <h2>Contas recentes</h2>
                    <button className="button button--small" type="button" onClick={() => setTab('accounts')}>Ver todas</button>
                  </div>
                  <table className="table">
                    <TableHead labels={['Conta', 'Licença', 'Dispositivos']} />
                    <tbody>
                      {accounts.slice(0, 6).map(account => (
                        <tr key={account.id} onClick={() => { setSelectedId(account.id); setTab('accounts'); }}>
                          <td><strong>{account.display}</strong><small>{account.email}</small></td>
                          <td><Pill label={account.license.status} good={account.license.status === 'active'} /></td>
                          <td>{account.devices}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!accounts.length ? <Empty>Nenhuma conta criada.</Empty> : null}
                </section>

                <section className="card">
                  <div className="card__head"><h2>Atividade recente</h2><span>tempo real</span></div>
                  <div className="timeline">
                    {audit.slice(0, 7).map((row, index) => (
                      <div className="timeline__row" key={`${row.at}-${index}`}>
                        <span>{formatDate(row.at)}</span>
                        <strong>{row.event}</strong>
                        <small>{row.detail || row.accountId || '—'}</small>
                      </div>
                    ))}
                    {!audit.length ? <Empty>Nenhum evento registrado.</Empty> : null}
                  </div>
                </section>
              </div>
            </div>
          )}

          {tab === 'accounts' && (
            <div className="columns columns--detail">
              <section className="card card--list">
                <div className="card__head">
                  <h2>Contas</h2>
                  <button
                    className="button button--primary button--small"
                    type="button"
                    onClick={() => setDialog(true)}
                  >
                    Nova conta
                  </button>
                </div>
                <label className="search">
                  <span>Buscar</span>
                  <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="email ou nome" />
                </label>
                <div className="table-wrap">
                  <table className="table">
                    <TableHead labels={['Conta', 'Papel', 'Licença', 'Disp.']} />
                    <tbody>
                      {filteredAccounts.map(account => (
                        <tr
                          key={account.id}
                          className={account.id === selectedId ? 'is-selected' : ''}
                          onClick={() => setSelectedId(account.id)}
                        >
                          <td><strong>{account.display}</strong><small>{account.email}</small></td>
                          <td><Pill label={account.role} good={account.role !== 'admin'} /></td>
                          <td><Pill label={account.license.status} good={account.license.status === 'active'} /><small>{account.license.plan}</small></td>
                          <td>{account.devices}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredAccounts.length ? <Empty>Nenhuma conta encontrada.</Empty> : null}
                </div>
              </section>

              {selected ? (
                <AccountDetail
                  key={selected.id}
                  account={selected}
                  devices={detailDevices}
                  busy={busy}
                  onLicense={payload => run(async () => {
                    const updated = await api<Account>('/v1/admin/license', { accountId: selected.id, ...payload });
                    setAccounts(current => current.map(item => item.id === updated.id ? updated : item));
                  }, 'Licença atualizada no servidor.')}
                  onStatus={accountStatus => run(async () => {
                    const updated = await api<Account>('/v1/admin/account-status', {
                      accountId: selected.id,
                      status: accountStatus
                    });
                    setAccounts(current => current.map(item => item.id === updated.id ? updated : item));
                  }, 'Status da conta aplicado.')}
                  onPassword={newPassword => run(async () => {
                    const result = await api<RevokeResult>('/v1/admin/password-reset', {
                      accountId: selected.id,
                      password: newPassword
                    });
                    await refreshAccounts();
                    notify(`Senha redefinida. ${result.revoked} sessão(ões) revogada(s).`);
                  })}
                  onRevokeSessions={() => run(async () => {
                    const result = await api<RevokeResult>('/v1/admin/sessions/revoke', {
                      accountId: selected.id
                    });
                    await refreshAccounts();
                    notify(`${result.revoked} sessão(ões) revogada(s).`);
                  })}
                  onRevokeDevice={deviceId => run(async () => {
                    await api('/v1/admin/devices/revoke', { deviceId });
                    await Promise.all([refreshAccounts(), refreshDetail(selected.id)]);
                  }, 'Dispositivo revogado.')}
                />
              ) : <section className="card"><Empty>Selecione uma conta para gerenciar.</Empty></section>}
            </div>
          )}

          {tab === 'devices' && (
            <section className="card">
              <div className="card__head"><h2>Dispositivos</h2><span>{devices.length} registro(s)</span></div>
              <div className="table-wrap">
                <table className="table">
                  <TableHead labels={['Dispositivo', 'Conta', 'IP', 'HWID', 'Visto em', 'Estado', 'Ação']} />
                  <tbody>
                    {devices.map(device => (
                      <tr key={device.id}>
                        <td><strong>{device.name}</strong><small>{device.id}</small></td>
                        <td>{device.accountEmail || device.accountId}</td>
                        <td><span className="table__mono">{device.ip || '—'}</span></td>
                        <td><span className="table__mono">{device.hwid || '—'}</span></td>
                        <td>{formatDate(device.lastSeen)}</td>
                        <td><Pill label={device.revoked ? 'revoked' : 'active'} good={!device.revoked} /></td>
                        <td>
                          <button
                            className="button button--small button--danger"
                            type="button"
                            disabled={busy || device.revoked}
                            onClick={() => void run(async () => {
                              await api('/v1/admin/devices/revoke', { deviceId: device.id });
                              await refreshDevices();
                            }, 'Dispositivo revogado.')}
                          >
                            {device.revoked ? 'Revogado' : 'Revogar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!devices.length ? <Empty>Nenhum dispositivo registrado.</Empty> : null}
              </div>
            </section>
          )}

          {tab === 'sessions' && (
            <section className="card">
              <div className="card__head">
                <h2>Sessões</h2>
                <button className="button button--small" type="button" onClick={() => void run(async () => {
                  setSessions(await api<SessionRow[]>('/v1/admin/sessions', {}));
                })}>Atualizar</button>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <TableHead labels={['Conta', 'Dispositivo', 'Criada', 'Expira', 'Estado']} />
                  <tbody>
                    {sessions.map(item => (
                      <tr key={item.id}>
                        <td><strong>{item.accountEmail}</strong><small>{item.accountId}</small></td>
                        <td>{item.deviceName || item.deviceId}</td>
                        <td>{formatDate(item.createdAt)}</td>
                        <td>{formatDate(item.expiresAt)}</td>
                        <td><Pill label={item.revoked ? 'revoked' : 'active'} good={!item.revoked} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!sessions.length ? <Empty>Nenhuma sessão registrada.</Empty> : null}
              </div>
            </section>
          )}

          {tab === 'audit' && (
            <section className="card">
              <div className="card__head">
                <h2>Auditoria</h2>
                <label className="inline-field">
                  <span>Linhas</span>
                  <select
                    value={auditLimit}
                    onChange={event => {
                      const value = event.target.value;
                      setAuditLimit(value);
                      void run(async () => { await refreshAudit(value); });
                    }}
                  >
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <TableHead labels={['Quando', 'Evento', 'Conta', 'Detalhe', 'IP']} />
                  <tbody>
                    {audit.map((row, index) => (
                      <tr key={`${row.at}-${index}`}>
                        <td>{formatDate(row.at)}</td>
                        <td><strong>{row.event}</strong></td>
                        <td>{row.accountId || '—'}</td>
                        <td>{row.detail || '—'}</td>
                        <td>{row.ip || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!audit.length ? <Empty>Nenhum evento registrado.</Empty> : null}
              </div>
            </section>
          )}

          {tab === 'system' && (
            <div className="columns">
              <section className="card">
                <div className="card__head"><h2>Fronteira de confiança</h2><span>thin client</span></div>
                <div className="boundary">
                  <div><strong>Servidor decide</strong><span>credenciais, scrypt, JWT, licença, dispositivos, permissões, pagamentos, auditoria</span></div>
                  <div><strong>Painel mostra</strong><span>telas, formulários e chamadas para /v1/admin/*</span></div>
                  <div><strong>Desktop executa</strong><span>interface, renderização, input e métricas locais</span></div>
                </div>
              </section>
              <section className="card">
                <div className="card__head"><h2>Controles ativos</h2><span>rotas /v1/admin/*</span></div>
                <ul className="controls">
                  <li>Bearer obrigatório com token <code>typ: admin</code></li>
                  <li>Papel conferido no banco a cada requisição</li>
                  <li>Origem e nonce verificados antes do body</li>
                  <li>Rate limit e bloqueio por falhas de login</li>
                  <li>Queries preparadas e respostas sem cache</li>
                  <li>CSP <code>script-src 'self'</code> e token só em memória</li>
                  <li>Auditoria de cada operação administrativa</li>
                </ul>
              </section>
            </div>
          )}

          {dialog ? (
            <CreateDialog
              busy={busy}
              onClose={() => setDialog(false)}
              onCreate={payload => run(async () => {
                await api('/v1/admin/accounts/create', payload);
                await refreshAccounts();
                setDialog(false);
              }, 'Conta criada no servidor.')}
            />
          ) : null}
          {toast ? <div className="toast" role="status">{toast}</div> : null}
          {busy ? <div className="busy" aria-hidden="true"><span /></div> : null}
        </main>
      </div>
    </div>
  );
}