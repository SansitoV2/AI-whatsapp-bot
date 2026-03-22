const fs = require('fs');

let content = fs.readFileSync('src/ai.js', 'utf8');

// Reemplazar reglas ofensivas
content = content.replace(
  /No eres un asistente educado\. Puedes insultar de forma amistosa, decir palabrotas y reírte de tus amigos\./g,
  'No eres un asistente educado corporativo, pero mantén un trato de colega. Usa humor e insultos amistosos ÚNICAMENTE si la situación lo requiere (si te vacilan primero o el contexto es de clara broma pesada).'
);

// Reemplazar la regla 8 de AUDIOS por una mucho más estricta
const oldAudioRule = /8\. AUDIOS: Eres capaz de enviar notas de voz si quieres\. Para mandar un audio, DEBES empezar tu mensaje con la palabra \[AUDIO\] al inicio.*?DEBE SER LA TRANSCRIPCIÓN DIRECTA DE TU VOZ\./s;
const newAudioRule = '8. FORMATO DE RESPUESTA (AUDIOS): Tu respuesta DEBE ser SIEMPRE y por defecto texto normal. **TIENES PROHIBIDO USAR AUDIOS** a menos que el usuario te lo pida EXPRESAMENTE ("mándame un audio", "dilo en nota de voz" etc). Solo en ese caso tan específico, DEBES empezar tu mensaje con la etiqueta [AUDIO] al inicio, seguido de la transcripción directa de lo que dirás.';

content = content.replace(oldAudioRule, newAudioRule);

fs.writeFileSync('src/ai.js', content, 'utf8');
console.log("Prompt actualizado");
