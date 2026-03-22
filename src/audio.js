const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const axios = require('axios');
const FormData = require('form-data');
const dotenv = require('dotenv');

dotenv.config();



/**
 * Transcribe un archivo base64 de WhatsApp de tipo audio a texto usando Groq/Whisper.
 * Usa ffmpeg para convertir .ogg originario en .mp3 temporal.
 */
async function transcribeAudioMsg(base64Data, messageId) {
    const tempInputPath = path.join(__dirname, `../temp_in_${messageId}.ogg`);
    const tempOutputPath = path.join(__dirname, `../temp_out_${messageId}.mp3`);
    
    // Escribir el buffer entrante al disco temporal
    fs.writeFileSync(tempInputPath, Buffer.from(base64Data, 'base64'));

    return new Promise((resolve, reject) => {
        ffmpeg(tempInputPath)
            .toFormat('mp3')
            .on('error', (err) => {
                console.error('Error convirtiendo audio:', err);
                cleanupTempFiles([tempInputPath, tempOutputPath]);
                reject(err);
            })
            .on('end', async () => {
                try {
                     // Groq también ofrece el modelo Whisper gratis y es brutalmente rápido
                     const transcription = await groq.audio.transcriptions.create({
                        file: fs.createReadStream(tempOutputPath),
                        model: "whisper-large-v3", // Modelo de OpenAI hosteado en Groq
                        response_format: "json",
                        language: "es",
                     });

                    cleanupTempFiles([tempInputPath, tempOutputPath]);
                    resolve(transcription.text);
                } catch (apiErr) {
                    console.error('Error en Whisper/Groq API:', apiErr);
                    cleanupTempFiles([tempInputPath, tempOutputPath]);
                    reject(apiErr);
                }
            })
            .save(tempOutputPath);
    });
}

function cleanupTempFiles(files) {
    files.forEach(f => {
        if (fs.existsSync(f)) {
            fs.unlinkSync(f);
        }
    });
}

/**
 * Genera un buffer de OGG Audio compatible con Note de Voz de WhatsApp (Opus)
 * A partir de texto usando ElevenLabs
 */
async function generateVoiceNote(textMessage, messageId) {
    const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJcg'; // Voz por dfecto
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
    
    const headers = {
        'Accept': 'audio/mpeg',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
    };

    const data = {
        text: textMessage,
        model_id: 'eleven_multilingual_v2', // Para que entienda español y palabrotas con buena dicción
        voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
        }
    };

    try {
        const response = await axios.post(url, data, { headers, responseType: 'stream' });
        
        const tempMp3 = path.join(__dirname, `../temp_tts_${messageId}.mp3`);
        const tempOgg = path.join(__dirname, `../temp_tts_${messageId}.ogg`);

        // Escribimos el mp3 descagado de Elevenlabs
        const writer = fs.createWriteStream(tempMp3);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                // Convertir a .OGG con codec libopus (Requerido por WhatsApp para que salga como nota de voz nativa)
                ffmpeg(tempMp3)
                    .audioCodec('libopus')
                    .toFormat('ogg')
                    .on('error', (err) => {
                         cleanupTempFiles([tempMp3, tempOgg]);
                         reject(err);
                    })
                    .on('end', () => {
                         // Leer el resultado y devolverlo en base64 para whatsapp-web.js
                         const base64Audio = fs.readFileSync(tempOgg, { encoding: 'base64' });
                         cleanupTempFiles([tempMp3, tempOgg]);
                         resolve(base64Audio);
                    })
                    .save(tempOgg);
            });
            
            writer.on('error', reject);
        });

    } catch (err) {
        console.error("Error generando voz con ElevenLabs:", err);
        return null;
    }
}

module.exports = {
   transcribeAudioMsg,
   generateVoiceNote
};