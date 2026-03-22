const fs = require('fs');

let content = fs.readFileSync('src/index.js', 'utf8');

// Añadir fecha de inicio del bot globalmente para descartar antiguos
const startupTimestampStr = `
// Guardar el momento exacto en el que levanta el bot para ignorar mensajes antiguos amontonados en bandeja
const startupTimestamp = Math.floor(Date.now() / 1000);

// Inicializamos cliente de WhatsApp
`;
content = content.replace(/\/\/ Inicializamos cliente de WhatsApp/, startupTimestampStr);


// Añadir la comprobacion en on('message')
const messageCheckStr = `
client.on('message', async (msg) => {
    // IGNORAR MENSAJES ANTIGUOS QUE LLEGAN DE GOLPE AL ARRANCAR
    if (msg.timestamp < startupTimestamp) {
        return;
    }

    const chat = await msg.getChat();
`;
content = content.replace(/client\.on\('message',\s*async\s*\(msg\)\s*=>\s*\{\s*const chat = await msg\.getChat\(\);/s, messageCheckStr);

fs.writeFileSync('src/index.js', content, 'utf8');
console.log("Solucionado el spam de arranque");
