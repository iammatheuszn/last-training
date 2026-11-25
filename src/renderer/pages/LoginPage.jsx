import { useCallback, useEffect, useState } from 'react';
import FluxLines from '../components/FluxLines';
import Reticle from '../components/Reticle';
import brandMark from '../assets/logo-marca.png';
import { copyDiagnostic, diagnostics, login } from '../services/auth';
import { openExternal } from '../services/system';
import { AUTHOR_NAME, PROJECT_URL } from '../config/project';
import './LoginPage.css';

const STATUS_LABEL = Object.freeze({
  ready: 'online',
  unavailable: 'sem resposta',
  not_configured: 'sem endpoint',
  insecure: 'https exigido',
  loading: 'checando'
});

function Eye({ open }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M1.5 10s3.2-5.5 8.5-5.5S18.5 10 18.5 10s-3.2 5.5-8.5 5.5S1.5 10 1.5 10Z" />
      <circle cx="10" cy="10" r="2.4" />
      {open ? null : <path d="M2.5 17.5 17.5 2.5" />}
    </svg>
  );
}

function diagnosticText(report, lastError) {
  const lines = [
    'LAST TRAINING — DIAGNÓSTICO DE LOGIN',
    `endpoint: ${report?.endpoint?.base || 'não configurado'}`,
    `origem: ${report?.endpoint?.sourceLabel || '—'}`,
    `https: ${report?.endpoint?.https ? 'sim' : 'não'}`,
    `backend: ${report?.status || 'desconhecido'}`,
    `http: ${report?.httpStatus || 0}`,
    `latência: ${report?.latencyMs || 0} ms`,
    ...(report?.checks || []).map(check => `[${check.status}] ${check.label}: ${check.detail}`)
  ];
  if (lastError) {
    lines.push(
      `erro: ${lastError.code || '—'}`,
      `código do servidor: ${lastError.serverCode || '—'}`,
      `http do login: ${lastError.httpStatus || 0}`,
      `request id: ${lastError.requestId || '—'}`
    );
  }
  lines.push(`gerado em: ${report?.generatedAt || new Date().toISOString()}`);
  return lines.join('\n');
}

export default function LoginPage({ version, authConfigured, onSuccess }) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const runDiagnostics = useCallback(async () => {
    try {
      const result = await diagnostics();
      if (result?.ok) setReport(result.data);
    } catch {
      setReport({
        status: 'unavailable',
        endpoint: { configured: Boolean(authConfigured), base: '', sourceLabel: '—', https: false },
        checks: [],
        httpStatus: 0,
        latencyMs: 0,
        message: 'A ponte de diagnóstico não respondeu.',
        generatedAt: new Date().toISOString()
      });
    }
  }, [authConfigured]);

  useEffect(() => {
    runDiagnostics();
  }, [runDiagnostics]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    if (!identity.trim() || !password) {
      setError('Informe o usuário e a senha.');
      return;
    }

    setSubmitting(true);
    setError('');
    setCopied(false);
    try {
      const result = await login({ identity: identity.trim(), password, remember });
      if (result?.ok && result.data?.authenticated) {
        onSuccess(result.data);
        return;
      }
      const info = result?.error || { code: 'UNKNOWN_ERROR', message: 'Não foi possível entrar.' };
      setError(info.message || 'Não foi possível entrar.');
      setLastError({
        code: info.code || 'UNKNOWN_ERROR',
        serverCode: info.serverCode || info.code || '',
        httpStatus: info.httpStatus || 0,
        requestId: info.requestId || '',
        retryAfter: info.retryAfter || 0
      });
      await runDiagnostics();
    } catch (failure) {
      setError(failure?.message || 'Falha de comunicação com o aplicativo.');
      setLastError({
        code: failure?.code || 'BRIDGE_MISSING',
        serverCode: failure?.code || '',
        httpStatus: 0,
        requestId: ''
      });
      await runDiagnostics();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    try {
      const result = await copyDiagnostic(diagnosticText(report, lastError));
      if (result?.ok) setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const status = report?.status || 'loading';

  function handleOpenSource() {
    void openExternal(PROJECT_URL);
  }

  return (
    <main className="login">
      <section className="login-stage" aria-label="Last Training">
        <div className="login-stage__flux">
          <FluxLines
            colors={['#ffffff', '#d8d8d8', '#ffffff']}
            speed={0.38}
            scale={1.85}
            turbulence={0.85}
            fluidity={0.12}
            rimWidth={0.22}
            sharpness={2.2}
            shimmer={1.6}
            glow={1.55}
            lineWidth={0.9}
            flowDirection="down"
            opacity={0.55}
            mouseInteraction
            mouseStrength={0.9}
            mouseRadius={0.28}
            clickSwirl
            dpr={1.5}
          />
        </div>
        <div className="login-stage__veil" />
        <Reticle />

        <header className="login-stage__head">
          <img className="login-stage__logo" src={brandMark} alt="Marca do Last Training" />
          <span className="login-stage__head-label">Aim lab / local</span>
        </header>

        <div className="login-stage__identity">
          <h1 className="login-wordmark">
            <span>LAST</span>
            <span className="login-wordmark__outline">TRAINING</span>
          </h1>
          <p className="login-stage__tagline">Treino de mira, medido.</p>
          <p className="login-stage__modes">aim, precisão, velocidade e crosshair</p>
        </div>
      </section>

      <section className="login-access">
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-form__head">
            <p className="login-form__kicker">Acesso</p>
            <h2>Seu treino continua aqui.</h2>
            <p className="login-form__intro">Entre com a conta e a licença ativas para continuar.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="identity">E-mail ou usuário</label>
            <input
              id="identity"
              className="field__control"
              type="text"
              autoComplete="username"
              spellCheck="false"
              value={identity}
              onChange={event => {
                setIdentity(event.target.value);
                setError('');
              }}
              disabled={submitting}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="password">Senha</label>
            <div className="field__wrap">
              <input
                id="password"
                className="field__control field__control--password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={event => {
                  setPassword(event.target.value);
                  setError('');
                }}
                disabled={submitting}
              />
              <button
                className="field__toggle"
                type="button"
                onClick={() => setShowPassword(value => !value)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={showPassword}
              >
                <Eye open={showPassword} />
              </button>
            </div>
          </div>

          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={event => setRemember(event.target.checked)}
              disabled={submitting}
            />
            Manter conectado neste dispositivo
          </label>

          <button className="submit" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <span className="submit__spinner" />
                Validando conta e licença
              </>
            ) : (
              'Entrar'
            )}
          </button>

          <div className="login-error" role="alert" aria-live="polite">
            {error ? <span>{error}</span> : null}
          </div>

          <section className={`login-diagnostics${diagnosticOpen ? ' is-open' : ''}`} aria-label="Diagnóstico de login">
            <button
              className="login-diagnostics__toggle"
              type="button"
              onClick={async () => {
                const next = !diagnosticOpen;
                setDiagnosticOpen(next);
                if (next) await runDiagnostics();
              }}
              aria-expanded={diagnosticOpen}
            >
              <span>Diagnóstico</span>
              <span className={`login-diagnostics__badge is-${status}`}>{STATUS_LABEL[status] || status}</span>
            </button>

            {diagnosticOpen ? (
              <div className="login-diagnostics__body">
                <dl>
                  <div><dt>Endpoint</dt><dd>{report?.endpoint?.base || 'não configurado'}</dd></div>
                  <div><dt>Origem</dt><dd>{report?.endpoint?.sourceLabel || '—'}</dd></div>
                  <div><dt>HTTPS</dt><dd>{report?.endpoint?.https ? 'sim' : 'não'}</dd></div>
                  <div>
                    <dt>Backend</dt>
                    <dd>
                      {STATUS_LABEL[status] || status}
                      {report?.latencyMs ? ` · ${report.latencyMs} ms` : ''}
                      {report?.httpStatus ? ` · HTTP ${report.httpStatus}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Última falha</dt>
                    <dd>
                      {lastError
                        ? `${lastError.code}${lastError.serverCode && lastError.serverCode !== lastError.code ? ` / ${lastError.serverCode}` : ''}${lastError.httpStatus ? ` · HTTP ${lastError.httpStatus}` : ''}`
                        : 'nenhuma'}
                    </dd>
                  </div>
                </dl>

                <ul className="login-diagnostics__checks">
                  {(report?.checks || []).map(check => (
                    <li key={check.id} className={`is-${check.status}`}>
                      <strong>{check.label}</strong>
                      <span>{check.detail}</span>
                    </li>
                  ))}
                </ul>

                <p className="login-diagnostics__message">{report?.message || 'Sem leitura de diagnóstico.'}</p>
                <button className="login-diagnostics__copy" type="button" onClick={handleCopy}>
                  {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
                </button>
              </div>
            ) : null}
          </section>

          <div className="login-footnote">
            <p>Contas e licenças são criadas no painel online. Aqui o acesso apenas é validado.</p>
            <p>Criado por {AUTHOR_NAME} · <button type="button" className="login-footnote__link" onClick={handleOpenSource}>Open source no GitHub ↗</button></p>
            {!authConfigured ? <p className="login-footnote__status">Serviço de autenticação indisponível nesta instalação.</p> : null}
          </div>

          <div className="login-meta">
            <span>LAST TRAINING</span>
            <span>v{version || '0.1.0'}</span>
          </div>
        </form>
      </section>
    </main>
  );
}
