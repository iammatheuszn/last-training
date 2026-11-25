import { useCallback, useEffect, useState } from 'react';
import brandMark from '../assets/logo-marca.png';
import {
  accountDevices,
  accountSessions,
  accountSummary,
  revokeAccountDevice,
  revokeAccountSession,
  revokeOtherAccountSessions
} from '../services/account';
import './Account.css';

function unwrap(result) {
  if (result?.ok) return result.data;
  const error = result?.error || {};
  throw new Error(error.message || 'Não foi possível consultar a conta.');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function shortId(value, size = 8) {
  if (!value) return '—';
  return value.length > size + 1 ? `${value.slice(0, size)}…` : value;
}

function Status({ item }) {
  if (item.current) return <span className="account-tag is-current">atual</span>;
  if (item.revoked) return <span className="account-tag is-revoked">revogado</span>;
  return <span className="account-tag is-active">ativo</span>;
}

export default function Account({ session, version, onLogout }) {
  const [summary, setSummary] = useState(null);
  const [devices, setDevices] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextSummary, nextDevices, nextSessions] = await Promise.all([
        unwrap(await accountSummary()),
        unwrap(await accountDevices()),
        unwrap(await accountSessions())
      ]);
      setSummary(nextSummary);
      setDevices(Array.isArray(nextDevices) ? nextDevices : []);
      setSessions(Array.isArray(nextSessions) ? nextSessions : []);
    } catch (failure) {
      setError(failure?.message || 'O servidor não respondeu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(key, operation, message) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      unwrap(await operation());
      await load();
      setNotice(message);
    } catch (failure) {
      setError(failure?.message || 'A operação não pôde ser concluída.');
    } finally {
      setBusy('');
    }
  }

  const license = summary?.license || session?.license || {};
  const account = summary?.account || session?.account || {};
  const facts = [
    ['Conta', account.display || '—'],
    ['E-mail', account.email || '—'],
    ['Identificador', shortId(account.id, 12)],
    ['Plano', license.plan || '—'],
    ['Status da licença', license.status || '—'],
    ['Expiração', license.expiresAt ? formatDate(license.expiresAt) : 'sem data'],
    ['Dispositivos ativos', String(summary?.counts?.devices ?? devices.filter(item => !item.revoked).length)],
    ['Sessões ativas', String(summary?.counts?.sessions ?? sessions.filter(item => !item.revoked).length)],
    ['Versão', `v${version || '0.1.0'}`]
  ];

  return (
    <div className="account-page">
      <header className="page-head">
        <p className="page-head__eyebrow">07 / Sessão</p>
        <h1>Conta e autorização.</h1>
        <p className="page-head__lead">
          Licença, dispositivos e sessões são lidos no servidor. O cliente não guarda senha, não cria
          contas e não altera o estado da licença localmente.
        </p>
      </header>

      {loading ? <div className="account-notice">Carregando dados autorizados do servidor…</div> : null}
      {error ? <div className="account-notice is-error" role="alert">{error}</div> : null}
      {notice ? <div className="account-notice is-ok" role="status">{notice}</div> : null}

      <div className="account-page__grid">
        <section className="account-card">
          <div className="account-card__top">
            <img src={brandMark} alt="" />
            <div>
              <span>sessão ativa</span>
              <strong>{license.status || 'ativa'}</strong>
            </div>
          </div>

          <dl className="account-card__facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <button type="button" className="account-card__logout" onClick={onLogout}>
            Encerrar sessão neste dispositivo
          </button>
        </section>

        <aside className="account-side">
          <div className="account-side__block">
            <span>Recursos liberados</span>
            {(license.features || []).length ? (
              <ul>
                {license.features.map(feature => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            ) : (
              <p>Nenhum recurso adicional informado pelo servidor.</p>
            )}
          </div>

          <div className="account-side__block">
            <span>Dispositivo atual</span>
            <dl className="account-side__facts">
              <div><dt>Nome</dt><dd>{summary?.currentDevice?.name || '—'}</dd></div>
              <div><dt>IP</dt><dd>{summary?.currentDevice?.ip || '—'}</dd></div>
              <div><dt>HWID</dt><dd>{shortId(summary?.currentDevice?.hwid, 16)}</dd></div>
            </dl>
          </div>

          <div className="account-side__block">
            <span>Armazenamento</span>
            <p>
              Tokens de acesso e renovação ficam criptografados no perfil do Windows. Histórico e
              recordes ficam em SQLite local. A senha é usada apenas no envio da autenticação e
              nunca é gravada.
            </p>
          </div>
        </aside>
      </div>

      <section className="account-panel">
        <div className="account-panel__head">
          <div>
            <span>Dispositivos</span>
            <h2>Esta conta usa {summary?.counts?.devices ?? devices.length} dispositivo(s) ativo(s).</h2>
          </div>
          <button
            type="button"
            className="account-panel__action"
            disabled={Boolean(busy) || sessions.every(item => item.current || item.revoked)}
            onClick={() => act('others', revokeOtherAccountSessions, 'Outras sessões foram revogadas.')}
          >
            {busy === 'others' ? 'Revogando…' : 'Encerrar outras sessões'}
          </button>
        </div>

        {devices.length ? (
          <div className="account-table-wrap">
            <table className="account-table">
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>IP</th>
                  <th>HWID</th>
                  <th>Último acesso</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {devices.map(device => (
                  <tr key={device.id}>
                    <td>
                      <strong>{device.name || 'sem nome'}</strong>
                      <small>{shortId(device.id)}</small>
                    </td>
                    <td>{device.ip || '—'}</td>
                    <td>{shortId(device.hwid, 16)}</td>
                    <td>{formatDate(device.lastSeen)}</td>
                    <td><Status item={device} /></td>
                    <td className="account-table__actions">
                      <button
                        type="button"
                        disabled={Boolean(busy) || device.current || device.revoked}
                        onClick={() => act(`device:${device.id}`, () => revokeAccountDevice(device.id), 'Dispositivo revogado.')}
                      >
                        {busy === `device:${device.id}` ? '…' : 'Revogar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="account-empty">Nenhum dispositivo registrado para esta conta.</p>
        )}
      </section>

      <section className="account-panel">
        <div className="account-panel__head">
          <div>
            <span>Sessões</span>
            <h2>Sessões ativas e históricas do servidor.</h2>
          </div>
        </div>

        {sessions.length ? (
          <div className="account-table-wrap">
            <table className="account-table">
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Sessão</th>
                  <th>Criada</th>
                  <th>Expira</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map(item => (
                  <tr key={item.id}>
                    <td>{item.deviceName || shortId(item.deviceId)}</td>
                    <td>{shortId(item.id)}</td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{formatDate(item.expiresAt)}</td>
                    <td><Status item={item} /></td>
                    <td className="account-table__actions">
                      <button
                        type="button"
                        disabled={Boolean(busy) || item.current || item.revoked}
                        onClick={() => act(`session:${item.id}`, () => revokeAccountSession(item.id), 'Sessão revogada.')}
                      >
                        {busy === `session:${item.id}` ? '…' : 'Revogar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="account-empty">Nenhuma sessão registrada para esta conta.</p>
        )}
      </section>
    </div>
  );
}
