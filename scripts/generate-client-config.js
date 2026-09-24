const fs = require('fs');
const path = require('path');

const apiBaseUrl = String(process.env.JCI_API_BASE_URL || '').trim().replace(/\/$/, '');
const outputPath = path.join(__dirname, '..', 'public', 'js', 'runtime-config.js');
const content = `window.JCI_CONFIG = { apiBaseUrl: ${JSON.stringify(apiBaseUrl)} };\n`;

fs.writeFileSync(outputPath, content, 'utf8');
console.log(`Generated client API configuration at ${outputPath}`);
