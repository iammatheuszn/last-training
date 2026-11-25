import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, modeList } from '../engine/modes';
import { loadAnalytics, loadRecords } from '../services/stats';
import './Statistics.css';

const CATEGORY_FILTERS = [{ id: 'all', label: 'Todas' }, ...CATEGORIES];
const HISTORY_COLUMNS = ['sessão', 'modalidade', 'pontuação', 'precisão', 'tempo/alvo', 'tremor', 'data'];
const RECORD_COLUMNS = ['modalidade', 'categoria', 'melhor', 'precisão', 'quando'];
const BREAKDOWN_COLUMNS = ['modalidade', 'categoria', 'sessões', 'melhor', 'média'];

const date = value => {
  if (typeof value !== 'string') return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('pt-BR');
};

const ms = value => Number.isFinite(value) && value > 0 ? `${Math.round(value)} ms` : '—';
const ratio = value => Number.isFinite(value) && value > 0 ? `${Math.round(value * 100)}%` : '—';

function Sparkline({ points }) {
  const geometry = useMemo(() => {
    const values = points.map(point => point.rolling);
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    const coords = values.map((value, index) => ({
      x: 8 + (index / (values.length - 1)) * 584,
      y: 136 - ((value - min) / span) * 112
    }));
    const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    return { line, area: `${line} L592,148 L8,148 Z`, min, max };
  }, [points]);

  if (!geometry) {
    return <div className="stats-chart__empty">Duas sessões filtradas desenham a curva.</div>;
  }

  return (
    <div className="stats-chart">
      <svg viewBox="0 0 600 160" role="img" aria-label="Evolução da pontuação por sessão">
        {[36, 72, 108].map(y => <line key={y} x1="8" x2="592" y1={y} y2={y} />)}
        <path className="stats-chart__area" d={geometry.area} />
        <path className="stats-chart__line" d={geometry.line} />
        {points.map((point, index) => (
          <circle
            key={point.id}
            cx={8 + (index / (points.length - 1)) * 584}
            cy={136 - ((point.rolling - geometry.min) / Math.max(1, geometry.max - geometry.min)) * 112}
            r="3"
          />
        ))}
      </svg>
      <div className="stats-chart__scale">
        <span>mín {geometry.min}</span>
        <span>máx {geometry.max}</span>
      </div>
    </div>
  );
}

export default function Statistics() {
  const [category, setCategory] = useState('all');
  const [mode, setMode] = useState('all');
  const [analytics, setAnalytics] = useState(null);
  const [recordRows, setRecordRows] = useState([]);

  useEffect(() => {
    let alive = true;
    loadAnalytics({ category, mode })
      .then(result => {
        if (alive) setAnalytics(result?.ok ? result.data : null);
      })
      .catch(() => {
        if (alive) setAnalytics(null);
      });
    return () => {
      alive = false;
    };
  }, [category, mode]);

  useEffect(() => {
    let alive = true;
    loadRecords()
      .then(result => {
        if (alive) setRecordRows(result?.ok ? result.data : []);
      })
      .catch(() => {
        if (alive) setRecordRows([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const metrics = [
    ['Sessões', analytics ? String(analytics.sessions) : '—', 'no filtro atual'],
    ['Melhor', analytics ? String(analytics.best) : '—', 'pontuação'],
    ['Média', analytics ? String(analytics.average) : '—', 'por sessão'],
    ['Precisão', analytics ? `${analytics.accuracy}%` : '—', 'média'],
    ['Tempo por alvo', analytics ? ms(analytics.averageTargetMs) : '—', 'aquisição'],
    ['Tremor', analytics ? ms(analytics.tremorMs) : '—', 'microcorreção'],
    ['Overshoot', analytics ? ratio(analytics.overshoot) : '—', 'flick / troca']
  ];

  return (
    <div className="stats-page">
      <header className="page-head">
        <p className="page-head__eyebrow">05 / Desempenho</p>
        <h1>O número vem do treino.</h1>
        <p className="page-head__lead">
          Filtre por categoria e modalidade. Tudo aqui é calculado sobre sessões gravadas no SQLite
          deste computador — sem dados de demonstração e sem inventar precisão onde o engine não mediu.
        </p>
      </header>

      <section className="stats-filters" aria-label="Filtros de estatística">
        <div className="stats-filters__group">
          <span>Categoria</span>
          <div className="stats-filters__buttons">
            {CATEGORY_FILTERS.map(item => (
              <button
                key={item.id}
                type="button"
                className={category === item.id ? 'is-active' : ''}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <label className="stats-filters__select">
          <span>Modalidade</span>
          <select value={mode} onChange={event => setMode(event.target.value)}>
            <option value="all">Todas as modalidades</option>
            {modeList.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="stats-metrics" aria-label="Resumo filtrado">
        {metrics.map(([label, value, hint]) => (
          <article className="stats-metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </section>

      <section className="stats-page__panel">
        <div className="stats-page__panel-head">
          <span>Evolução por sessão</span>
          <span>{analytics?.trend.length || 0} ponto(s)</span>
        </div>
        <div className="stats-page__panel-body">
          <Sparkline points={analytics?.trend || []} />
          <p className="stats-chart__note">
            A linha é a média móvel das últimas cinco sessões dentro do filtro. Cada ponto conserva
            a ordem real de execução, não uma ordenação por recorde.
          </p>
        </div>
      </section>

      <section className="stats-page__panel">
        <div className="stats-page__panel-head">
          <span>Sessões recentes</span>
          <span>{analytics?.recent.length || 0} registro(s)</span>
        </div>
        <div className="stats-table stats-table--wide" role="table" aria-label="Sessões recentes filtradas">
          <div className="stats-table__row stats-table__row--head" role="row">
            {HISTORY_COLUMNS.map(column => <span key={column} role="columnheader">{column}</span>)}
          </div>
          {!analytics?.recent.length ? (
            <div className="stats-table__empty">
              <span>Nenhuma sessão neste filtro</span>
              <p>Treine uma modalidade compatível ou remova o filtro para ver o histórico local.</p>
            </div>
          ) : analytics.recent.map((item, index) => (
            <div className="stats-table__row" role="row" key={item.id}>
              <span role="cell">#{analytics.sessions - index}</span>
              <span role="cell">{item.modeLabel || item.mode}</span>
              <span role="cell">{item.score}</span>
              <span role="cell">{Math.round(item.accuracy)}%</span>
              <span role="cell">{ms(item.averageTargetMs)}</span>
              <span role="cell">{ms(item.tremorMs)}</span>
              <span role="cell">{date(item.at)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stats-page__panel">
        <div className="stats-page__panel-head">
          <span>Leitura por modalidade</span>
          <span>{analytics?.breakdown.length || 0} ativa(s)</span>
        </div>
        <div className="stats-table stats-table--five">
          <div className="stats-table__row stats-table__row--head" role="row">
            {BREAKDOWN_COLUMNS.map(column => <span key={column} role="columnheader">{column}</span>)}
          </div>
          {!analytics?.breakdown.length ? (
            <div className="stats-table__empty">
              <span>Sem base para comparar</span>
              <p>O comparativo aparece quando houver sessões no filtro selecionado.</p>
            </div>
          ) : analytics.breakdown.map(item => (
            <div className="stats-table__row" role="row" key={item.mode}>
              <span role="cell">{item.label}</span>
              <span role="cell">{item.category}</span>
              <span role="cell">{item.sessions}</span>
              <span role="cell">{item.best}</span>
              <span role="cell">{item.average}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stats-page__panel">
        <div className="stats-page__panel-head">
          <span>Recordes locais</span>
          <span>{recordRows.length} modalidades</span>
        </div>
        <div className="stats-table stats-table--five">
          <div className="stats-table__row stats-table__row--head" role="row">
            {RECORD_COLUMNS.map(column => <span key={column} role="columnheader">{column}</span>)}
          </div>
          {recordRows.map(item => (
            <div className="stats-table__row" role="row" key={item.mode}>
              <span role="cell">{item.label || item.mode}</span>
              <span role="cell">{item.category}</span>
              <span role="cell">{Math.round(item.score)}</span>
              <span role="cell">{Math.round(item.accuracy)}%</span>
              <span role="cell">{date(item.achievedAt)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="stats-page__note">
        <span>escopo</span>
        <p>
          Estatísticas permanecem no dispositivo. Autenticação, licença, dispositivos e auditoria
          continuam sob responsabilidade exclusiva do servidor.
        </p>
      </div>
    </div>
  );
}
