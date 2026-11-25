import brandMark from '../assets/logo-marca.png';
import './BootScreen.css';

export default function BootScreen() {
  return (
    <main className="boot">
      <div className="boot__brand">
        <img className="boot__mark" src={brandMark} alt="" />
        <span className="boot__name">LAST TRAINING</span>
      </div>
      <div className="boot__line" />
    </main>
  );
}
