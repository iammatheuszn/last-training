import brandMark from '../assets/logo-marca.png';
import './UnlockedScreen.css';

export default function UnlockedScreen({ session, version, onLogout }) {
  const display = session?.account?.display || session?.account?.id || 'conta verificada';

  return (
    <main className="unlocked">
      <div className="unlocked__top">
        <img className="unlocked__logo" src={brandMark} alt="" />
        <span>LAST TRAINING</span>
      </div>

      <section className="unlocked__body">
        <p className="unlocked__eyebrow">Sessão autorizada</p>
        <h1>Acesso liberado.</h1>
        <p className="unlocked__copy">
          Conta e licença validadas. O dashboard e o engine local estão prontos para operar.
        </p>

        <dl className="unlocked__facts">
          <div>
            <dt>Conta</dt>
            <dd>{display}</dd>
          </div>
          <div>
            <dt>Licença</dt>
            <dd>{session?.license?.status || 'ativa'}</dd>
          </div>
          <div>
            <dt>Plano</dt>
            <dd>{session?.license?.plan || '—'}</dd>
          </div>
          <div>
            <dt>Versão</dt>
            <dd>{version || '0.1.0'}</dd>
          </div>
        </dl>

        <button type="button" className="unlocked__logout" onClick={onLogout}>
          Encerrar sessão
        </button>
      </section>
    </main>
  );
}
