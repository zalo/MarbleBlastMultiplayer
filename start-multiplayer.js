const { spawn } = require('child_process');

const game = spawn('node', ['server/bundle.js'], { stdio: 'inherit' });
const party = spawn('npx', ['partykit', 'dev'], { cwd: 'party', stdio: 'inherit' });

function cleanup() {
  game.kill();
  party.kill();
  process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

game.on('exit', cleanup);
party.on('exit', cleanup);
