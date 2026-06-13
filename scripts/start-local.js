const { spawn } = require('child_process');

const cdsCli = require.resolve('@sap/cds-dk/bin/cds.js');
const env = {
  ...process.env,
  FRESHCHAIN_LOCAL_MODEL_URL: process.env.FRESHCHAIN_LOCAL_MODEL_URL || 'http://localhost:9000/v2/predict'
};

console.log(`Starting CAP with local model endpoint ${env.FRESHCHAIN_LOCAL_MODEL_URL}`);

const child = spawn(process.execPath, [cdsCli, 'serve'], {
  env,
  stdio: 'inherit'
});

child.on('error', error => {
  console.error(`Failed to start CAP: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', code => process.exit(code ?? 1));
