import { GameApp } from './core/GameApp';

// Temporary: mirror console.error into a hidden element so shader errors are visible.
const errlog = document.createElement('div');
errlog.id = 'errlog';
errlog.style.display = 'none';
errlog.style.position = 'fixed';
errlog.style.left = '0';
errlog.style.top = '0';
errlog.style.maxWidth = '100%';
errlog.style.fontSize = '9px';
errlog.style.whiteSpace = 'pre-wrap';
errlog.style.zIndex = '9999';
errlog.style.pointerEvents = 'none';
document.body.appendChild(errlog);
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  errlog.style.display = 'block';
  errlog.textContent += args.map((a) => String(a)).join(' ') + '\n';
  originalError(...args);
};

const canvas = document.getElementById('game');
const boot = document.getElementById('boot');

// Wholesome welcome / credits modal. The game is held until it is accepted.
const welcome = document.getElementById('welcome');
const welcomeAccepted = new Promise<void>((resolve) => {
  if (!welcome) {
    resolve();
    return;
  }
  const dismiss = (): void => {
    welcome.classList.add('hidden');
    resolve();
  };
  document.getElementById('welcome-continue')?.addEventListener('click', dismiss);
  window.addEventListener('keydown', (event) => {
    if (!welcome.classList.contains('hidden') && (event.key === 'Escape' || event.key === 'Enter')) {
      dismiss();
    }
  });
});

async function main(): Promise<void> {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #game not found');
  }

  const app = new GameApp(canvas);
  await app.init();
  boot?.classList.add('hidden');

  // Hold the game (no render loop, no updates) until the welcome modal is accepted.
  await welcomeAccepted;
  app.start();
}

main().catch((error: unknown) => {
  console.error(error);
  if (boot) {
    boot.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
  }
});
