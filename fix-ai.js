const fs = require('fs');
let file = fs.readFileSync('src/ai.js', 'utf8');

// Como el gemini-2.5-flash te ha tirado Rate Limit gratis porque la API v1beta la limitan, vamos a bajar a gemini-1.5-flash-8b que es el más rápido y gratis infinito.
file = file.replace(/model: "gemini-2.5-flash"/g, 'model: "gemini-1.5-flash-8b"');

fs.writeFileSync('src/ai.js', file);
