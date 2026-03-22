const fs = require('fs');

const file = fs.readFileSync('src/audio.js', 'utf8');
const newFile = file.replace(/const { Groq } = require\('groq-sdk'\);/g, '')
                    .replace(/const groq = new Groq\(\{[\s\S]*?\}\);/g, '');

fs.writeFileSync('src/audio.js', newFile);
console.log('Fixed auth!');
