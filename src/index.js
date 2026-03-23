const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { processMessage } = require('./ai');
const { transcribeAudioMsg, generateVoiceNote } = require('./audio');
const dotenv = require('dotenv');

dotenv.config();

// Guardar el momento exacto en el que levanta el bot para ignorar mensajes antiguos amontonados en bandeja
const START_TIME = Math.floor(Date.now() / 1000);

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

let inactivityTimer = null;
const INACTIVITY_TIME_MS = 3.5 * 60 * 60 * 1000; // 3.5 horas aprox

function resetInactivityTimer(chat) {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
        console.log("[DEBUG] Grupo inactivo por horas. Generando mensaje espontáneo...");
        try {
            const promptToAi = "[SISTEMA]: El grupo lleva un par de horas inactivo. Aprovecha para reavivarlo soltando un dato curioso o gracioso, preferiblemente que tenga algo que ver con el lore de algún miembro del grupo o sobre la casa. Hazlo de forma natural, 1 o 2 líneas, sin decir que es por inactividad.";
            const aiResponse = await processMessage(promptToAi, "SYSTEM", false, true);

            if (aiResponse && aiResponse.type === "text" && aiResponse.content) {
                let responseText = aiResponse.content.trim();
                const hasAudioTag = /\[AUDIO\]/i.test(responseText);
                const delayMs = Math.min(5000, responseText.length * 40);

                if (hasAudioTag) {
                    await chat.sendStateRecording();
                    const textToSpeak = responseText.replace(/\[AUDIO\]/gi, '').trim();
                    await new Promise(r => setTimeout(r, delayMs)); // Simular tiempo de grabación
                    try {
                        const base64Audio = await generateVoiceNote(textToSpeak, "inactivity" + Date.now());
                        const media = new MessageMedia('audio/ogg', base64Audio);
                        await chat.sendMessage(media, { sendAudioAsVoice: true });
                    } catch (err) {
                        await chat.sendMessage(textToSpeak);
                    }
                } else {
                    await chat.sendStateTyping();
                    await new Promise(r => setTimeout(r, delayMs)); // Simular tiempo de escritura
                    await chat.sendMessage(responseText);
                }
            }
        } catch (err) {
            console.error("[DEBUG] Error enviando mensaje de inactividad:", err);
        }
    }, INACTIVITY_TIME_MS);
}

// Escuchamos mensajes entrantes
client.on('message', async msg => {
    // IGNORAR mensajes que llegaron antes de que el bot se encendiera 
    // Comparamos el timestamp del mensaje (en segundos) con el de cuando arrancó el programa
    if (msg.timestamp < START_TIME) {
        console.log("[DEBUG] Ignorando mensaje antiguo del arranque...");
        return; 
    }

    if (!botReady) {
        console.log("[DEBUG] Ignorando mensaje porque el bot aún se está inicializando...");
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

        // Reiniciamos el temporizador de inactividad
        resetInactivityTimer(chat);

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
        const senderId = contact.id._serialized;

        // Comprobar si nos citan, si nos mencionan o si dicen nuestro nombre
        let isQuoted = false;
        if (msg.hasQuotedMsg) {
            const quotedMsg = await msg.getQuotedMessage();
            if (quotedMsg && quotedMsg.fromMe) {
                isQuoted = true;
            }
        }

        const mentionedIds = msg.mentionedIds || [];
        const isMentioned = mentionedIds.includes(client.info.wid._serialized);
        
        const lowerBody = textContent.toLowerCase();
        const calledNames = ['jose', 'sansito', 'bot', 'ia'];
        const isNamed = calledNames.some(name => lowerBody.includes(name));

        // 20% de probabilidad de responder a cualquier otro mensaje de forma espontánea
        const isSpontaneous = Math.random() < 0.20;

        const shouldReply = isMentioned || isQuoted || isNamed || isSpontaneous;

        // 4. Enviar a Gemini para tener la respuesta de SansitoV2
        if (shouldReply) {
            await chat.sendStateTyping(); // Simular pensando antes de llamar a Gemini
        }

        const promptToAi = `[Usuario: ${senderName}]: ${textContent}`;
        // Pasamos senderId y un false a isAudio temporalmente si no lo extrajimos arriba, y por ultimo shouldReply
        // Pero en tu versión original solo pasabas processMessage(promptToAi). 
        // Vamos a reajustar para pasar (textContent, senderId, msg.hasMedia, shouldReply)
        const isAudio = msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt');
        const aiResponse = await processMessage(textContent, senderId, isAudio, shouldReply);

        // Si no debía responder, aiResponse será null y acaba aquí en silencio
        if (!shouldReply || !aiResponse) return;

        // 5. Enviar mensaje de vuelta
        if (aiResponse.type === "text" && aiResponse.content && aiResponse.content.trim().length > 0) {
            let responseText = aiResponse.content.trim();
            
            // Si la IA decide mandar un audio (contiene [AUDIO])
            const hasAudioTag = /\[AUDIO\]/i.test(responseText);
            
            // Calcular retraso artificial basado en la longitud (max 5 segundos)
            const dynamicDelay = Math.min(5000, responseText.length * 40);

            if (hasAudioTag) {
                await chat.sendStateRecording(); // Cambiar estado a "Grabando audio..."
                // Simular el tiempo que tardaría en grabar
                await new Promise(r => setTimeout(r, dynamicDelay));

                const textToSpeak = responseText.replace(/\[AUDIO\]/gi, '').trim();
                console.log("[DEBUG] Generando audio de voz para:", textToSpeak);
                try {
                    const base64Audio = await generateVoiceNote(textToSpeak, msg.id.id);
                    const media = new MessageMedia('audio/ogg', base64Audio);
                    await msg.reply(media, undefined, { sendAudioAsVoice: true });
                    return; // Terminamos aquí para no enviar también el texto
                } catch (err) {
                    console.error("[DEBUG] Error generando audio, cayendo a texto plano. Error:", err);
                    await msg.reply("*(A Sansito se le atascó la voz en la garganta)* " + textToSpeak);
                }
            } else {
                await chat.sendStateTyping(); // Mantener estado de "Escribiendo..."
                // Simular el tiempo de escritura real
                await new Promise(r => setTimeout(r, dynamicDelay));
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
