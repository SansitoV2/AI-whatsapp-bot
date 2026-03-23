const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { processMessage } = require('./ai');
const { transcribeAudioMsg, generateVoiceNote } = require('./audio');
const dotenv = require('dotenv');

dotenv.config();

// Guardar el momento exacto en el que levanta el bot para ignorar mensajes antiguos amontonados en bandeja

// Inicializamos cliente de WhatsApp
// Dependiendo del SO, a veces requiere configurar el executablePath de Chrome,
// pero por defecto LocalAuth permite escanear QR y mantener sesión sin problemas.
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu']
    }
});

let botReady = false;
client.on('ready', () => { 
    botReady = true;
    console.log('¡Bandera verde! Ahora proceso mensajes.'); 
});

client.on('qr', (qr) => {
    // Genera el QR en terminal para escanearlo con el WhatsApp de la IA
    qrcode.generate(qr, { small: true });
    
    console.log('\n--- O COPIA ESTE TEXTO EN UN GENERADOR DE QR ONLINE ---\n');
    console.log(qr);
    console.log('\n---------------------------------------------------------------\n');
});


client.on('change_state', state => {
    console.log('[DEBUG] Estado de conexión:', state);
});
client.on('disconnected', (reason) => {
    console.log('[DEBUG] Cliente desconectado!! Razón:', reason);
});
client.on('authenticated', () => {
    console.log('[DEBUG] ¡Autenticación correcta! El QR ha servido. Cargando chats...');
});
client.on('auth_failure', msg => {
    console.error('[DEBUG] FALLO DE AUTENTICACION', msg);
});
client.on('loading_screen', (percent, message) => {
    console.log('[DEBUG] CARGANDO WHATSAPP WEB', percent, '%', message);
});

client.on('ready', () => {
    console.log('El bot está listo y conectado a WhatsApp!');
});

// Escuchamos mensajes entrantes
client.on('message', async msg => {
    // IGNORAR mensajes que llegaron antes de que el bot se encendiera
    if (!botReady) {
        console.log("[DEBUG] Ignorando mensaje antiguo del arranque...");
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
        const aiResponse = await processMessage(promptToAi);

        // 5. Enviar mensaje de vuelta
        if (aiResponse && aiResponse.type === "text" && aiResponse.content && aiResponse.content.trim().length > 0) {
            let responseText = aiResponse.content.trim();
            
            // Si la IA decide mandar un audio (empieza por [AUDIO])
            if (responseText.startsWith('[AUDIO]') || responseText.startsWith('[Audio]')) {
                const textToSpeak = responseText.replace(/\[AUDIO\]|\[Audio\]/i, '').trim();
                console.log("[DEBUG] Generando audio de voz para:", textToSpeak);
                try {
                    const base64Audio = await generateVoiceNote(textToSpeak);
                    const media = new MessageMedia('audio/ogg', base64Audio);
                    await msg.reply(media, undefined, { sendAudioAsVoice: true });
                    return; // Terminamos aquí para no enviar también el texto
                } catch (err) {
                    console.error("[DEBUG] Error generando audio, cayendo a texto plano. Error:", err);
                    await msg.reply("*(A Sansito se le atascó la voz en la garganta)* " + textToSpeak);
                }
            } else {
                await msg.reply(responseText);
            }
        } else if (aiResponse && aiResponse.type === "tool_call") {
            // Se ha ejecutado una herramienta (ej. guardar en memoria), lo registramos en consola pero NO respondemos en WhatsApp
            console.log(`[BOT] Operación en segundo plano realizada por la IA (tool_call): Memoria/Historial actualizado para el usuario: ${senderName}`);
        } else {
            console.log("[DEBUG] Interceptado intento de enviar mensaje vacío o undefined a WhatsApp. Respuesta fue:", aiResponse);
        }

    } catch (error) {
        console.error('Error al procesar mensaje:', error);
    }
});

// Iniciamos cliente
client.initialize();
