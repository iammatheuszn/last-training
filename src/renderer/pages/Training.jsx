import { useCallback, useEffect, useRef, useState } from 'react';
import TrainingEngine from '../engine/Engine';
import { CATEGORIES, MODES, modesByCategory } from '../engine/modes';
import { loadSettings } from '../services/settings';
import { saveSession } from '../services/stats';
import './Training.css';

const IDLE_HUD = {
  mode: '',
  score: 0,
  accuracy: 0,
  hits: 0,
  misses: 0,
  remainingMs: 30000,
  paused: false,
  running: false
};

const clock = ms => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export default function Training({ mode, onModeChange, onNavigate }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [phase, setPhase] = useState('idle');
  const [hud, setHud] = useState({ ...IDLE_HUD, mode: MODES[mode]?.label || '' });
  const [result, setResult] = useState(null);

  const finish = useCallback(async finalResult => {
    let saved = null;
    try {
      saved = await saveSession(finalResult);
    } catch {
    }
    const data = saved?.ok ? saved.data : null;
    setResult({ ...finalResult, summary: data?.summary || null, storageError: !data });
    setPhase('finished');
  }, []);

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.togglePause();
    setPhase(engine.paused ? 'paused' : 'running');
  }, []);

  useEffect(() => {
    let alive = true;
    let engine = null;
    loadSettings()
      .then(config => {
        if (!alive || !canvasRef.current) return;
        engine = new TrainingEngine(canvasRef.current, {
          mode,
          settings: config || {},
          onHud: setHud,
          onFinish: finish
        });
        engineRef.current = engine;
        engine.resize();
        setPhase('idle');
        setResult(null);
        setHud({
          ...IDLE_HUD,
          mode: MODES[mode]?.label || '',
          remainingMs: MODES[mode]?.durationMs || IDLE_HUD.remainingMs
        });
      })
      .catch(() => {
        if (alive) setPhase('idle');
      });
    return () => {
      alive = false;
      if (engine) engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [mode, finish]);

  useEffect(() => {
    if (phase !== 'running' && phase !== 'paused') return undefined;
    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, togglePause]);

  function begin() {
    if (!engineRef.current) return;
    setResult(null);
    setPhase('running');
    engineRef.current.start();
  }

  function stop() {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.running) engine.stop();
    engine.reset();
    setResult(null);
    setPhase('idle');
    setHud({
      ...IDLE_HUD,
      mode: MODES[mode]?.label || '',
      remainingMs: MODES[mode]?.durationMs || IDLE_HUD.remainingMs
    });
  }

  return (
    <div className="training">
      <header className="page-head training__head">
        <p className="page-head__eyebrow">02 / Engine local</p>
        <h1>Treino começa no punho.</h1>
        <p className="page-head__lead">
          Simulação em 120 Hz com render independente por frame. Nenhum movimento de mouse, clique
          ou pontuação trafega pela rede.
        </p>
      </header>

      <div className="training__modes" role="group" aria-label="Modalidade">
        {CATEGORIES.map(category => (
          <div className="training__mode-group" key={category.id}>
            <span className="training__mode-group-label">{category.label}</span>
            <div className="training__mode-buttons">
              {modesByCategory(category.id).map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === mode ? 'is-active' : ''}
                  disabled={phase === 'running' || phase === 'paused'}
                  onClick={() => onModeChange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="training__layout">
        <section className="training__stage">
          <canvas ref={canvasRef} className="training__canvas" />
          <div className="training__overlay" aria-hidden="true">
            <span>{MODES[mode]?.description}</span>
          </div>

          {phase === 'idle' && !result ? (
            <div className="training__prompt">
              <span>pronto</span>
              <strong>{MODES[mode]?.label}</strong>
              <button type="button" onClick={begin}>Iniciar sessão</button>
            </div>
          ) : null}

          {phase === 'finished' && result ? (
            <div className="training__result">
              <span>{result.storageError ? 'resultado local indisponível' : 'sessão registrada'}</span>
              <strong>{result.score}</strong>
              <dl>
                <div><dt>Precisão</dt><dd>{result.accuracy}%</dd></div>
                <div><dt>Acertos</dt><dd>{result.hits}</dd></div>
                <div><dt>Erros</dt><dd>{result.misses}</dd></div>
                <div><dt>Tremor</dt><dd>{Math.round(result.tremorMs || 0)} ms</dd></div>
                {result.targetCount > 0 ? (
                  <div>
                    <dt>Tempo/alvo</dt>
                    <dd>{Math.round((result.targetTimeTotalMs || 0) / result.targetCount)} ms</dd>
                  </div>
                ) : null}
                {result.mode === 'flick' || result.mode === 'switching' ? (
                  <div><dt>Overshoot</dt><dd>{Math.round((result.overshootTotal || 0) / 100)}%</dd></div>
                ) : null}
              </dl>
              <div className="training__result-actions">
                <button type="button" onClick={begin}>Treinar de novo</button>
                <button type="button" onClick={() => onNavigate('stats')}>Ver estatísticas</button>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="training__hud" aria-live="polite">
          <div className="hud-block hud-block--time">
            <span>Tempo restante</span>
            <strong>{clock(hud.remainingMs)}</strong>
          </div>
          <div className="hud-block">
            <span>Pontuação</span>
            <strong>{Math.round(hud.score)}</strong>
          </div>
          <div className="hud-block">
            <span>Precisão</span>
            <strong>{Math.round(hud.accuracy)}%</strong>
          </div>
          <div className="hud-block hud-block--small">
            <span>Acertos</span><strong>{hud.hits}</strong>
          </div>
          <div className="hud-block hud-block--small">
            <span>Erros</span><strong>{hud.misses}</strong>
          </div>

          <div className="training__controls">
            {phase === 'idle' || phase === 'finished' ? (
              <button type="button" className="training__start" onClick={begin}>
                {phase === 'finished' ? 'Repetir' : 'Iniciar'}
              </button>
            ) : (
              <button type="button" className="training__start" onClick={togglePause}>
                {phase === 'paused' ? 'Retomar' : 'Pausar'}
              </button>
            )}
            <button
              type="button"
              className="training__stop"
              onClick={stop}
              disabled={phase === 'idle'}
            >
              Encerrar
            </button>
          </div>

          <p className="training__note">
            A mira segue o ponteiro um para um, inclusive fora da área de treino. Clique esquerdo
            para acertar nas modalidades de alvo. Esc pausa pela janela do sistema.
          </p>
        </aside>
      </div>
    </div>
  );
}
