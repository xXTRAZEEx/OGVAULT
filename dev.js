import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const api = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit' });
const web = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5173'], {
  stdio: 'inherit',
});

function stop() {
  api.kill();
  web.kill();
  process.exit();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', (code) => {
  if (code) {
    web.kill();
    process.exit(code);
  }
});
