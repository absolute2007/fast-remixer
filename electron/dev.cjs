const { spawn } = require('child_process');
const http = require('http');

const vite = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
  shell: true,
  stdio: 'inherit',
});

let electron;
let closed = false;

function waitForVite(retries = 80) {
  http
    .get('http://127.0.0.1:5173', (res) => {
      res.resume();
      startElectron();
    })
    .on('error', () => {
      if (retries <= 0) {
        cleanup(1);
        return;
      }
      setTimeout(() => waitForVite(retries - 1), 250);
    });
}

function startElectron() {
  if (electron) return;
  electron = spawn('npx', ['electron', '.'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
  });
  electron.on('exit', (code) => cleanup(code ?? 0));
}

function cleanup(code) {
  if (closed) return;
  closed = true;
  if (electron && !electron.killed) electron.kill();
  if (!vite.killed) vite.kill();
  process.exit(code);
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
vite.on('exit', (code) => {
  if (!electron) cleanup(code ?? 1);
});

waitForVite();
