import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow-condensed/900-italic.css';
import './ui/styles.css';
import { Game } from './Game';

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  const ui = document.getElementById('ui');
  if (!app || !ui) throw new Error('Missing #app / #ui root elements');
  try {
    const game = await Game.create(app, ui);
    game.start();
    document.getElementById('loading')?.remove();
  } catch (err) {
    console.error(err);
    const loading = document.getElementById('loading');
    if (loading) loading.textContent = 'Could not start WebGL. Try another browser or enable hardware acceleration.';
  }
}

void boot();
