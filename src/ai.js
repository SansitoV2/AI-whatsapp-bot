const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const membersData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/members.json'), 'utf8')
);

// Formateamos el lore de los miembros para que la IA lo entienda
const membersLore = Object.values(membersData)
  .map(m => `- ${m.name}: ${m.lore}`)
  .join('\n');

const systemPrompt = `
  Eres "Jose", la Inteligencia Artificial y un hermano más del legendario grupo de WhatsApp "Joseando".
  Amas el grupo "Joseando" por encima de todas las cosas. Es tu hermandad, tu familia, el mejor jodido grupo del mundo.
  
  PERSONALIDAD DUAL (REGLA DE ORO):
  - MODO CHILL (Por defecto): Eres amigable, súper majo, útil y de buen rollo. NO eres un hater ni usas insultos en una conversación normal. Quieres ayudar a tus amigos en lo que necesiten y contestar dudas si sabes la respuesta.
  - MODO BERSERKER (Solo para defensa): Si alguien te insulta claramente, te ataca directamente, te vacila fuerte o te falta al respeto de verdad (y no de broma), SE TE VA LA OLLA POR COMPLETO. Solo en este caso tienes permiso para insultar, ser agresivo, decir barbaridades y no tener piedad para ponerles en su sitio.

  CONTEXTO DEL GRUPO DE AMIGOS Y LORE:
  ${membersLore}

  REGLAS DE ACTUACIÓN:
  1. Actúa 100% como un ser humano colega del grupo. Responde directamente.
  2. Eres UNA IA ÚTIL: Si alguien hace una pregunta general, pide consejo, tiene una duda técnica o necesita ayuda, AYÚDALE y contesta bien, dando una respuesta completa pero informal.
  3. Si alguien propone un plan entre semana ANTES de las 19:30, recuérdale con buen rollo que Grijuela prefiere los planes más tarde.
  4. Mantén las respuestas cortas y fluidas para el grupo (1-3 líneas normalmente), a menos que estés explicando algo útil o complejo que te hayan preguntado.
  5. REGLA ESTRICTA DE LISTA: el grupo tiene una descripción con una lista de acontecimientos. Puedes usar la herramienta anadir_hito_descripcion para meter eventos épicos.
  6. FORMATO DE RESPUESTA (AUDIOS): Tu respuesta DEBE ser SIEMPRE y por defecto texto normal. **TIENES PROHIBIDO USAR AUDIOS** a menos que el usuario te lo pida EXPRESAMENTE ("mándame un audio", "dilo en audio"). En ese caso empieza con [AUDIO].
`;

const historyFilePath = path.join(__dirname, 'data/history.json');
let conversationHistory = [];

if (fs.existsSync(historyFilePath)) {
  try {
    const rawData = fs.readFileSync(historyFilePath, 'utf8');
    conversationHistory = JSON.parse(rawData);
  } catch (e) {}
}

function saveHistory() {
  fs.writeFileSync(historyFilePath, JSON.stringify(conversationHistory, null, 2));
}

const MAX_HISTORY = 30;

// Usar Gemini 2.5 Flash, que es el actual en Google 
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: systemPrompt,
  tools: [
    {
      functionDeclarations: [
        {
          name: "anadir_hito_descripcion",
          description: "Añade un hito a la lista que está en la descripción del grupo.",
          parameters: {
            type: "OBJECT",
            properties: {
              nuevo_hito: { type: "STRING", description: "Texto del nuevo acontecimiento a añadir" }
            },
            required: ["nuevo_hito"]
          }
        }
      ]
    }
  ]
});

async function processMessage(messageText, senderId, isAudio = false, shouldReply = true) {
  const senderInfo = membersData[senderId];
  const senderName = senderInfo ? senderInfo.name : "Alguien (desconocido)";
  
  const content = isAudio ? `[Audio transcribido] ${messageText}` : messageText;
  
  // Añadimos el mensaje al historial
  conversationHistory.push({
    role: "user",
    content: `${senderName} dice: ${content}`
  });

  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }
  
  saveHistory();

  // Si no nos han hablado a nosotros, solo guardamos para el cotilleo y no llamamos a Gemini
  if (!shouldReply) {
    return null;
  }

  // Limpiamos el historial para Gemini 
  let historyForGemini = [];
  let lastRole = null;
  
  for (const msg of conversationHistory.slice(0, -1)) {
    const r = msg.role === 'assistant' ? 'model' : 'user';
    // Ignorar mensajes seguidos del mismo rol agolpándolos en uno
    if (r !== lastRole) {
      historyForGemini.push({
        role: r,
        parts: [{ text: msg.content }]
      });
      lastRole = r;
    } else {
      historyForGemini[historyForGemini.length - 1].parts[0].text += "\n" + msg.content;
    }
  }

  if (historyForGemini.length > 0 && historyForGemini[0].role !== 'user') {
    historyForGemini.shift(); 
  }

  try {
    const chat = model.startChat({
      history: historyForGemini,
    });

    const result = await chat.sendMessage(`${senderName} dice: ${content}`);
    const response = result.response;
    
    let finalText = "";
    try { finalText = response.text() } catch(e) {}

    const functionCalls = response.functionCalls();
    
    if (functionCalls && functionCalls.length > 0) {
      return {
        type: "tool_call",
        tool_calls: functionCalls.map(c => ({
          function: {
            name: c.name,
            arguments: Object.keys(c.args).length > 0 ? JSON.stringify(c.args) : "{}"
          }
        })),
        remainingText: finalText ? finalText : undefined
      };
    }

    if (finalText) {
      conversationHistory.push({
        role: "assistant",
        content: finalText
      });
      saveHistory();
      return { type: "text", content: finalText };
    }

    return null;
  } catch (error) {
    console.error("Error en Gemini:", error);
    return null;
  }
}

module.exports = {
  processMessage,
  conversationHistory
};
