import { CATEGORIES, MODES, modesByCategory } from '../engine/modes';
import './Modes.css';
import './Crosshair.css';

const CATEGORY = CATEGORIES.find(item => item.id === 'crosshair');
const TRAININGS = modesByCategory('crosshair');

export default function Crosshair({ onStart }) {
  return (
    <div className="modes-page crosshair-page">
      <header className="page-head">
        <p className="page-head__eyebrow">03 / Categoria crosshair</p>
        <h1>A mira por si só.</h1>
        <p className="page-head__lead">
          {CATEGORY.description} O crosshair segue o ponteiro um para um e continua visível mesmo
          quando o mouse sai da área. Nenhum clique entra na pontuação.
        </p>
      </header>

      <div className="crosshair-page__note">
        <span>Regra da categoria</span>
        <strong>posição absoluta · sem clique · 1:1</strong>
      </div>

      <div className="modes-page__list">
        {TRAININGS.map(mode => (
          <article className="mode-row" key={mode.id}>
            <div className="mode-row__index">{mode.id.replace('crosshair_', 'x').slice(0, 2).toUpperCase()}</div>
            <div className="mode-row__body">
              <h2>{mode.label}</h2>
              <p className="mode-row__focus">{mode.focus}</p>
              <p className="mode-row__copy">{mode.copy}</p>
              <div className="mode-row__metrics">
                {mode.metrics.map(metric => (
                  <span key={metric}>{metric}</span>
                ))}
              </div>
            </div>
            <div className="mode-row__status">
              <button type="button" className="mode-row__tag" onClick={() => onStart(mode.id)}>
                iniciar treino
              </button>
              <span className="mode-row__note">
                {Math.round(MODES[mode.id].durationMs / 1000)} segundos / sem clique
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
