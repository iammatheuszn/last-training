import { modeList } from '../engine/modes';
import './Modes.css';

export default function Modes({ onStart }) {
  return (
    <div className="modes-page">
      <header className="page-head">
        <p className="page-head__eyebrow">03 / Treino</p>
        <h1>Nove formas de afiar a mão.</h1>
        <p className="page-head__lead">
          Cada modalidade roda no engine local, sem chamada de rede por frame. O servidor autoriza
          o acesso; o cálculo e a captura de entrada permanecem neste computador.
        </p>
      </header>

      <div className="modes-page__list">
        {modeList.map((mode, index) => (
          <article className="mode-row" key={mode.id}>
            <div className="mode-row__index">{String(index + 1).padStart(2, '0')}</div>
            <div className="mode-row__body">
              <h2>{mode.label}</h2>
              <p className="mode-row__focus">{mode.focus}</p>
              <p className="mode-row__copy">{mode.copy}</p>
              <div className="mode-row__metrics">
                <span className={`mode-row__category mode-row__category--${mode.category}`}>
                  {mode.category}
                </span>
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
                {Math.round(mode.durationMs / 1000)} segundos / engine local
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
