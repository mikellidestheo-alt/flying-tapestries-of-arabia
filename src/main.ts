import './style.css';
import { Game } from './game/game';
import { registerServiceWorker } from './platform';

const canvas = document.getElementById('game') as HTMLCanvasElement;
try {
  new Game(canvas);
  registerServiceWorker();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.getElementById('fatalMsg')!.textContent =
    /webgl/i.test(msg) ? 'Your browser could not start WebGL graphics.' : msg;
  document.getElementById('fatal')!.classList.remove('hidden');
}
