import { useEffect, useRef, useState } from 'react';
import CometDial from '../components/CometDial';
import { getOverlayState, loadSettings, saveSettings } from '../services/settings';
import './Customization.css';

const DEFAULTS = Object.freeze({
  sensitivity: 52,
  targetSize: 68,
  crosshairOpacity: 80,
  feedback: 45,
  overlaySize: 55,
  overlayGap: 38,
  overlayThickness: 35,
  overlayEnabled: false,
  overlayMode: 'cursor'
});

const FIELDS = [
  {
    key: 'targetSize',
    label: 'Tamanho do alvo',
    hint: 'Diâmetro dos alvos nos treinos de clicking e flick.',
    group: 'engine'
  },
  {
    key: 'crosshairOpacity',
    label: 'Opacidade da mira',
    hint: 'Transparência do crosshair no engine e no overlay.',
    group: 'overlay'
  },
  {
    key: 'feedback',
    label: 'Intensidade do feedback',
    hint: 'Força do retorno visual e sonoro local.',
    group: 'engine'
  },
  {
    key: 'overlaySize',
    label: 'Tamanho do overlay',
    hint: 'Extensão das linhas da mira sobre o desktop.',
    group: 'overlay'
  },
  {
    key: 'overlayGap',
    label: 'Vão central',
    hint: 'Abertura no centro entre as quatro linhas.',
    group: 'overlay'
  },
  {
    key: 'overlayThickness',
    label: 'Espessura',
    hint: 'Peso do traço desenhado pelo overlay.',
    group: 'overlay'
  }
];

const MODE_OPTIONS = [
  { id: 'cursor', label: 'Seguir cursor', hint: 'A mira acompanha o ponteiro.' },
  { id: 'center', label: 'Centro do monitor', hint: 'A mira fica fixa no display ativo.' }
];

export default function Customization() {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [overlay, setOverlay] = useState(null);
  const latest = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    Promise.all([loadSettings(), getOverlayState()])
      .then(([config, state]) => {
        if (!alive) return;
        const next = { ...DEFAULTS, ...(config || {}) };
        latest.current = next;
        setSettings(next);
        setOverlay(state?.ok ? state.data : null);
      })
      .catch(() => {
        if (alive) {
          latest.current = { ...DEFAULTS };
          setSettings({ ...DEFAULTS });
        }
      });
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, []);

  function commit() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const patch = latest.current;
      if (!patch) return;
      saveSettings(patch)
        .then(() => {
          setSaved(true);
          return getOverlayState();
        })
        .then(state => {
          if (state?.ok) setOverlay(state.data);
        })
        .catch(() => {
          setSaved(false);
        });
    }, 120);
  }

  function update(key, value) {
    const next = { ...(latest.current || DEFAULTS), [key]: value };
    latest.current = next;
    setSettings(next);
    setSaved(false);
    commit();
  }

  function restore() {
    const reset = { ...DEFAULTS };
    latest.current = reset;
    setSettings(reset);
    clearTimeout(timer.current);
    saveSettings(reset)
      .then(() => {
        setSaved(true);
        return getOverlayState();
      })
      .then(state => {
        if (state?.ok) setOverlay(state.data);
      })
      .catch(() => {
        setSaved(false);
      });
  }

  if (!settings) {
    return (
      <div className="custom-page">
        <header className="page-head">
          <p className="page-head__eyebrow">05 / Ajuste</p>
          <h1>A mira é sua. O limite é o punho.</h1>
          <p className="page-head__lead">Carregando configuração local...</p>
        </header>
      </div>
    );
  }

  return (
    <div className="custom-page">
      <header className="page-head">
        <p className="page-head__eyebrow">05 / Ajuste</p>
        <h1>A mira é sua. O limite é o punho.</h1>
        <p className="page-head__lead">
          Valores de 0 a 100 salvos no perfil do Windows pelo processo principal. Nenhuma
          preferência é enviada ao servidor e nenhuma licença depende destes controles.
        </p>
      </header>

      <section className="custom-panel" aria-labelledby="overlay-title">
        <div className="custom-panel__head">
          <div>
            <span className="custom-panel__eyebrow">Overlay desktop</span>
            <h2 id="overlay-title">Crosshair fora da janela</h2>
          </div>
          <button
            type="button"
            className={`custom-toggle${settings.overlayEnabled ? ' is-on' : ''}`}
            onClick={() => update('overlayEnabled', !settings.overlayEnabled)}
            aria-pressed={settings.overlayEnabled}
          >
            <span aria-hidden="true" />
            {settings.overlayEnabled ? 'ativado' : 'desativado'}
          </button>
        </div>

        <p className="custom-panel__copy">
          Janela transparente, sem clique e sempre no topo. O overlay só aparece com sessão
          autenticada e fora da janela principal — não interfere na mira do engine nem injeta
          entrada no jogo.
        </p>

        <div className="custom-modes" role="group" aria-label="Modo do overlay">
          {MODE_OPTIONS.map(option => (
            <button
              key={option.id}
              type="button"
              className={settings.overlayMode === option.id ? 'is-active' : ''}
              onClick={() => update('overlayMode', option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.hint}</span>
            </button>
          ))}
        </div>

        <div className="custom-panel__status">
          <span>estado em execução</span>
          <strong>{overlay?.visible ? 'visível no desktop' : 'oculto'}</strong>
        </div>
      </section>

      <div className="custom-page__grid">
        {FIELDS.map(field => (
          <section className="dial-card" key={field.key}>
            <div className="dial-card__head">
              <span className="dial-card__label">{field.label}</span>
              <span className="dial-card__value">{settings[field.key]}%</span>
            </div>
            <CometDial
              value={settings[field.key]}
              label={field.label}
              size={218}
              accent="#ffffff"
              ink="#f4f4f4"
              onChange={value => update(field.key, value)}
            />
            <p>{field.hint}</p>
          </section>
        ))}
      </div>

      <div className="custom-page__foot">
        <span>{saved ? 'configuração confirmada' : 'salvamento automático ativo'}</span>
        <button type="button" onClick={restore}>
          Restaurar padrão
        </button>
      </div>
    </div>
  );
}
