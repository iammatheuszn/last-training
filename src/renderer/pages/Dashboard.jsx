import { useEffect, useState } from 'react';
import { modeList } from '../engine/modes';
import { loadRecords, loadSummary } from '../services/stats';
import './Dashboard.css';

export default function Dashboard({ session, onNavigate, onStart }) {
  const [summaryData, setSummaryData] = useState(null);
  const [recordRows, setRecordRows] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all([loadSummary(), loadRecords()])
      .then(([sum, rec]) => {
        if (!alive) return;
        setSummaryData(sum?.ok ? sum.data : null);
        setRecordRows(rec?.ok ? rec.data : []);
      })
      .catch(() => {
        if (alive) {
          setSummaryData(null);
          setRecordRows([]);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const display = session?.account?.display || session?.account?.email || 'conta verificada';
  const plan = session?.license?.plan || 'sem plano';

  return (
    <div className="dash">
      <section className="dash__hero">
        <span className="dash__hero-ghost" aria-hidden="true">READY</span>
        <div className="dash__hero-copy">
          <p className="dash__eyebrow">Sessão autorizada / {display}</p>
          <h1>Pronto para treinar.</h1>
          <p className="dash__lead">
            Ambiente local calibrado, licença validada no servidor e zero dependência de rede
            durante cada frame. Escolha uma modalidade quando o engine entrar em operação.
          </p>
          <div className="dash__hero-actions">
            <button type="button" className="dash__primary" onClick={() => onStart('clicking')}>
              Iniciar clicking
            </button>
            <button type="button" className="dash__ghost-button" onClick={() => onNavigate('modes')}>
              Ver modalidades
            </button>
            <button type="button" className="dash__ghost-button" onClick={() => onNavigate('custom')}>
              Ajustar mira
            </button>
          </div>
        </div>
      </section>

      <section className="dash__section">
        <div className="dash__section-head">
          <h2>Leitura local</h2>
          <span>SQLite / dados deste computador</span>
        </div>

        <div className="dash__metrics">
          <article className="metric">
            <span className="metric__label">Sessões registradas</span>
            <strong>{summaryData ? summaryData.sessions : '—'}</strong>
            <span className="metric__foot">histórico local</span>
          </article>
          <article className="metric">
            <span className="metric__label">Melhor desempenho</span>
            <strong>{summaryData ? summaryData.best : '—'}</strong>
            <span className="metric__foot">recorde salvo</span>
          </article>
          <article className="metric">
            <span className="metric__label">Média recente</span>
            <strong>{summaryData ? summaryData.average : '—'}</strong>
            <span className="metric__foot">últimas sessões</span>
          </article>
          <article className="metric metric--wide">
            <span className="metric__label">Licença</span>
            <strong className="metric__word">{plan}</strong>
            <span className="metric__foot">
              {session?.license?.expiresAt
                ? `válida até ${new Date(session.license.expiresAt).toLocaleDateString('pt-BR')}`
                : 'sem data de expiração'}
            </span>
          </article>
        </div>

        {!summaryData ? (
          <p className="dash__empty">
            Nenhuma sessão salva neste dispositivo. Os números aparecem aqui quando o engine
            gravar o primeiro treino — nada é inventado para preencher o painel.
          </p>
        ) : null}
      </section>

      <section className="dash__section">
        <div className="dash__section-head">
          <h2>Modalidades</h2>
          <button type="button" className="dash__link" onClick={() => onNavigate('modes')}>
            abrir todas
          </button>
        </div>

        <div className="dash__modes">
          {modeList.map((mode, index) => {
            const record = recordRows.find(row => row.mode === mode.id);
            return (
              <button
                key={mode.id}
                type="button"
                className="mode-card"
                onClick={() => onStart(mode.id)}
                aria-label={`Iniciar ${mode.label}`}
              >
                <span className="mode-card__index">{String(index + 1).padStart(2, '0')}</span>
                <span className="mode-card__title">{mode.label}</span>
                <span className="mode-card__copy">{mode.focus}</span>
                <span className="mode-card__foot">
                  <span>{record?.score ? `recorde ${record.score}` : '—'}</span>
                  <span aria-hidden="true">↗</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="dash__section dash__section--last">
        <div className="dash__section-head">
          <h2>Operação</h2>
          <span>estado da instalação</span>
        </div>
        <div className="dash__operation">
          <div>
            <span>Conta</span>
            <strong>{session?.account?.id?.slice(0, 18) || 'verificada'}</strong>
          </div>
          <div>
            <span>Recursos liberados</span>
            <strong>{session?.license?.features?.length || 0}</strong>
          </div>
          <div>
            <span>Origem da autorização</span>
            <strong>servidor</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
