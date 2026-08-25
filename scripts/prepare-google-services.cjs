const fs = require('fs');
const path = require('path');

const source = process.env.GOOGLE_SERVICES_JSON;
const destination = path.join(__dirname, '..', 'android', 'app', 'google-services.json');

if (!source) {
  if (process.env.EAS_BUILD_PROFILE === 'production') {
    throw new Error('Missing GOOGLE_SERVICES_JSON EAS file secret for the production Android build.');
  }
  process.exit(0);
}

if (!fs.existsSync(source)) throw new Error(`GOOGLE_SERVICES_JSON does not exist at ${source}`);
const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
if (!parsed.project_info || !Array.isArray(parsed.client)) throw new Error('GOOGLE_SERVICES_JSON is not a valid Firebase Android configuration.');

fs.copyFileSync(source, destination);
console.log('Prepared Android Firebase configuration.');
