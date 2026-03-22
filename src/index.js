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
    qrcode.generate(qr, { small: true }); console.log('
--- O COPIA ESTE TEXTO EN UN GENERADOR DE QR ONLINE ---
'); console.log(qr); console.log('
---------------------------------------------------------------
');
    console.log('Escanea este código QR con el WhatsApp que quieres usar como bot.');
});

client.on('ready', () => {
    console.log('¡Joseando IA está conectada y lista para dar por saco!');
});

// Listener de mensajes
let inactivityTimer = null;
const INACTIVITY_LIMIT_MS = 1000 * 60 * 60 * 3; // 3 Horas de inactividad por defecto

function resetInactivityTimer(chatId) {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
        try {
            console.log("[INACTIVO] El grupo lleva horas callado, mandando dato curioso...");
            const simulatedMessage = "El grupo lleva horas callado y la gente está aburrida. Cuenta un dato súper curioso, turbio o escatológico para romper el hielo y revivir el grupo.";
            
            // Pasamos un ID inventado como si fuera sistema
            chat.sendStateTyping();
        const response = await processMessage(simulatedMessage, "bot_system_event", false);
            
            if (response && response.type === "text") {
                const isExplicitAudio = response.content.startsWith('[AUDIO]') || response.content.startsWith('[AUDIO');
                const cleanContent = response.content.replace(/\[AUDIO\]/gi, '').trim();

                const sendAsAudio = isExplicitAudio; // Solo mandar audio si la IA lo indica explícitamente
                
                const chat = await client.getChatById(chatId);

                if (sendAsAudio) {
                    chat.sendStateRecording();
                    const audioBase64 = await generateVoiceNote(cleanContent, "inactivo_" + Date.now());
                    if (audioBase64) {
                        const media = new MessageMedia('audio/ogg', audioBase64);
                        await chat.sendMessage(media, { sendAudioAsVoice: true });
                    } else {
                        await chat.sendMessage(cleanContent);
                    }
                } else {
                    await chat.sendMessage(cleanContent);
                }
            }
        } catch (e) {
            console.error("Error en el evento de inactividad:", e);
        }
    }, INACTIVITY_LIMIT_MS);
}


client.on('message', async (msg) => {
    // IGNORAR MENSAJES ANTIGUOS QUE LLEGAN DE GOLPE AL ARRANCAR
    if (msg.timestamp < startupTimestamp) {
        return;
    }

    const chat = await msg.getChat();


    // Reiniciar el temporizador para este grupo en concreto si hablan (y es grupo)
    if (chat.isGroup) {
        resetInactivityTimer(chat.id._serialized);
    }

    // Operar tanto en grupos como en privados para pruebas
    // if (!chat.isGroup) return;

    // Aquí podríamos poner el ID del grupo objetivo para que no conteste en TODOS los grupos.
    // Ej: if (chat.id._serialized !== process.env.GROUP_CHAT_ID) return;
    
    // Si en un futuro quieres saber el ID de tu grupo, descomenta esto para que se imprima la primera vez que mandes mensaje:
    // console.log(`El ID de este grupo es: ${chat.id._serialized}`);

    // Extraer número del remitente
    const senderId = msg.author || msg.from; // En grupos msg.author es el remitente real, en privados msg.from
    console.log(`[DEBUG] Mensaje recibido de ID: ${senderId}`); // Para ver qué formato de número llega

    // Comprobar si el mensaje es una respuesta directa (swipe a la derecha) a un mensaje previo del bot
    let isReplyToBot = false;
    if (msg.hasQuotedMsg) {
        try {
            const quotedMsg = await msg.getQuotedMessage();
            // Dependiendo si es grupo o privado el autor originario viene en author o from
            const quotedAuthor = quotedMsg.author || quotedMsg.from;
            const botId = client.info.wid._serialized;
            const botIdShort = client.info.wid.user; // Sólo el numero sin el '@c.us'

            console.log(`[DEBUG] Mensaje citado pertenece a: ${quotedAuthor}, El ID del bot completo es: ${botId}, El bot corto es: ${botIdShort}`);
            
            // Comprobamos si coincide el sufijo entero o al menos que incluya el número del bot
            if (quotedAuthor === botId || (quotedAuthor && quotedAuthor.includes(botIdShort)) || quotedAuthor === "65662147911737@lid") {
                isReplyToBot = true;
                console.log("¡Citaron a Jose!, forzando respuesta...");
            }
        } catch (e) {
            console.error("Error al leer el mensaje citado:", e);
        }
    }

    // --- ALEATORIEDAD ---
    // En lugar de responder a todo, le damos un 15% de probabilidad de intervenir,
    // A MENOS que se le mencione ("jose", "ia", "bot", o @etiquetando), sea chat privado, O TE ESTÉN CITANDO DIRECTAMENTE.
    
    // 1. Comprobamos si le etiquetan con el @ nativo de WhatsApp
    const botIdStr = client.info.wid._serialized;
    const botIdShortStr = client.info.wid.user;
    const hasTaggedBot = msg.mentionedIds && (
        msg.mentionedIds.includes(botIdStr) || 
        msg.mentionedIds.includes("65662147911737@lid") || 
        msg.mentionedIds.some(id => id && id.includes(botIdShortStr))
    );

    // 2. Comprobamos si dicen su nombre
    const isNameMentioned = msg.body.toLowerCase().includes('jose') || 
                            msg.body.toLowerCase().includes('ia') || 
                            msg.body.toLowerCase().includes('bot');
                            
    const isMentioned = hasTaggedBot || isNameMentioned;
    
    // Si es privado y no es el propio bot, responder siempre. En grupos aplicar aleatoriedad.
    const shouldReply = !chat.isGroup || isMentioned || isReplyToBot || Math.random() < 0.15;

    if (!shouldReply) {
       // Aún así, leemos el mensaje silenciosamente en la IA para que tenga memoria de qué hablan.
       processMessage(msg.body, senderId, msg.hasMedia); // Si es media, ahora lo ignoramos en la memoria
       return;
    }

    try {
        let textToProcess = msg.body;

        // Si es un audio
        if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
            const media = await msg.downloadMedia();
            try {
                textToProcess = await transcribeAudioMsg(media.data, msg.id.id);
                console.log(`[Audio Transcrito de ${senderId}]: ${textToProcess}`);
            } catch(e) {
                textToProcess = "[Audio ininteligible o fallo en procesarlo]";
            }
        }

        chat.sendStateTyping();
        const response = await processMessage(textToProcess, senderId, msg.type === 'ptt');

        if (!response) return;

        // Si la IA decide responder con texto normal
        if (response.type === "text") {
            // Comprobar si la IA ha decidido mandar un audio mediante la etiqueta [AUDIO]
            const isExplicitAudio = response.content.startsWith('[AUDIO]') || response.content.startsWith('[AUDIO');
            const cleanContent = response.content.replace(/\[AUDIO\]/gi, '').trim();

            const sendAsAudio = isExplicitAudio || msg.type === 'ptt'; // Solo mandar audio si responde a un audio o la IA lo indica
            
            if (sendAsAudio) {
                try {
                    console.log("[AUDIO] Generando nota de voz con ElevenLabs...");
                    chat.sendStateRecording();
                    const audioBase64 = await generateVoiceNote(cleanContent, msg.id.id);
                    if (audioBase64) {
                        const media = new MessageMedia('audio/ogg', audioBase64);
                        await chat.sendMessage(media, { sendAudioAsVoice: true });
                        console.log("[AUDIO] ¡Nota de voz enviada!");
                    } else {
                        await chat.sendMessage(cleanContent);
                    }
                } catch(e) {
                    console.error("Fallo al generar audio:", e);
                    await chat.sendMessage(cleanContent);
                }
            } else {
                await chat.sendMessage(cleanContent);
            }
        }

        // Si la IA decide llamar a una función (Herramienta: Cambiar descripción)
        if (response.type === "tool_call") {
            // Si además de la herramienta traía algo de texto limpio, lo mandamos primero
            if (response.remainingText) {
                await chat.sendMessage(response.remainingText);
            }

            for (const tool of response.tool_calls) {
                if (tool.function.name === 'anadir_hito_descripcion') {
                     // Solo actuar en grupos reales
                     if (!chat.isGroup) {
                         await chat.sendMessage("Chaval, esto es un chat privado, aquí no hay descripción del grupo que cambiar.");
                         continue;
                     }

                     const args = typeof tool.function.arguments === 'string' 
                          ? JSON.parse(tool.function.arguments) 
                          : tool.function.arguments;
                     
                     let currentDesc = chat.description || '';
                     let newDesc = currentDesc + '\n- ' + args.nuevo_hito;
                     
                     try {
                         // Cambiar la descripción
                         await chat.setDescription(newDesc);
                         await chat.sendMessage(`Hecho. He añadido esto a la descripción:\n${args.nuevo_hito}`);
                     } catch (descError) {
                         console.error("Error cambiando descripción:", descError);
                         await chat.sendMessage(`Intenté cambiar la descripción pero WhatsApp no me deja. Seguramente no soy administrador o hay una actualización fastidiando.`);
                     }
                }
            }
        }

    } catch (err) {
        console.error("Error al procesar mensaje con la IA:", err);
    }
});

client.initialize();
