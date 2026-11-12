/* Copie l'interface (../web) dans l'app Electron avant l'empaquetage */
'use strict';
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'web');
const dst = path.join(__dirname, 'web');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('web copié →', dst);
