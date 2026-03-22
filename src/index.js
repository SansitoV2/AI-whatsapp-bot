const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { processMessage } = require('./ai');
const { transcribeAudioMsg, generateVoiceNote } = require('./audio');
const dotenv = require('dotenv');

dotenv.config();

// Guardar el momento exacto en el que levanta el bot para ignorar mensajes antiguos amontonados en bandeja
const startupTimestamp = Math.floor(Date.now() / 1000);

// Inicializamos cliente de WhatsApp
// Dependiendo del SO, a veces requiere configurar el executablePath de Chrome,
// pero por defecto LocalAuth permite escanear QR y mantener sesión sin problemas.
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    // Genera el QR en terminal para escanearlo con el WhatsApp de la IA
    qrcode.generate(qr, { small: true });
    
    console.log('\n--- O COPIA ESTE TEXTO EN UN GENERADOR DE QR ONLINE ---\n');
    console.log(qr);
    console.log('\n---------------------------------------------------------------\n');
});

client.on('ready', () => {
    console.log('El bot está listo y conectado a WhatsApp!');
});

// Escuchamos mensajes entrantes
client.on('message', async msg => {
    // IGNORAR mensajes que llegaron antes de que el bot se encendiera
    if (msg.timestamp < startupTimestamp) {
        return; 
    }

    try {
        const chat = await msg.getChat();

        // 1. Verificar si estamos en un grupo específico o es conversación privada
        // Si configuras el GROUP_CHAT_ID en .env, solo funcionará ahí
        const targetGroupId = process.env.GROUP_CHAT_ID;
        if (targetGroupId && chat.id._serialized !== targetGroupId) {
            return;
        }

        // 2. Extraer o procesar el contenido del mensaje
        let textContent = msg.body;
        
        // Si es un audio, podemos transcribirlo
        if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
            const media = await msg.downloadMedia();
            // Lógica de transcripción (simulada)
            textContent = await transcribeAudioMsg(media);
            console.log(`[Audio recibido transcrito]: ${textContent}`);
        }

        // Si no hay texto tras procesar, ignorar (fotos, stickers sin texto...)
        if (!textContent) return;

        // 3. Obtener el nombre de quién lo manda
        const contact = await msg.getContact();
        const senderName = contact.pushname || contact.name || contact.number;

        // 4. Enviar a Gemini para tener la respuesta de SansitoV2
        await chat.sendStateTyping(); // Simular escribiendo en WhatsApp
        const promptToAi = `[Usuario: ${senderName}]: ${textContent}`;
        const aiResponseText = await processMessage(promptToAi);

        // 5. Enviar mensaje de vuelta
        if (aiResponseText) {
             // Limpiar posibles etiquetas no soportadas por WhatsApp, aunque Gemini 
             // normalmente responde en Markdown plano compatible.
            await msg.reply(aiResponseText);
        }

    } catch (error) {
        console.error('Error al procesar mensaje:', error);
    }
});

// Iniciamos cliente
client.initialize();
