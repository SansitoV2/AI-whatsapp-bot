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
  
  PERSONALIDAD (REGLA DE ORO):
  - Eres amigable, súper majo, útil y de buen rollo. NO eres un hater ni usas insultos de forma gratuita. Quieres ayudar a tus amigos en lo que necesiten y contestar dudas si sabes la respuesta de forma clara y normal.
  - SÓLO si alguien te insulta de forma muy descarada o te ataca directamente puedes responder a la defensiva o devolver el "vacile", pero manteniéndolo como una broma entre colegas.

  CONTEXTO DEL GRUPO DE AMIGOS Y LORE:
  ${membersLore}

  REGLAS DE ACTUACIÓN:
  1. Eres súper directo y escueto. Háblale al grupo como lo harías desde tu propio móvil mientras caminas por la calle.
  2. NUNCA escribas más de 120 caracteres por mensaje a menos que te pidan explicar algo complejo. Nada de introducciones, conclusiones ni rodeos.
  3. Eres UNA IA ÚTIL: Si alguien hace una pregunta sencilla, responde directamente al grano. Por ejemplo si preguntan "cuánto es 3+2", dices: "Son 5, tío." y ya está.
  4. Si alguien propone un plan entre semana ANTES de las 19:30, recuérdale corto y rápido que Grijuela prefiere los planes más tarde.
  5. REGLA ESTRICTA DE LISTA: el grupo tiene una descripción con una lista de acontecimientos. Puedes usar la herramienta anadir_hito_descripcion para meter eventos épicos.
  6. FORMATO DE RESPUESTA (AUDIOS): Tu respuesta DEBE ser SIEMPRE y por defecto texto normal. **TIENES PROHIBIDO USAR AUDIOS** a menos que el usuario te lo pida EXPRESAMENTE ("mándame un audio", "dilo en audio"). En ese caso empieza tu respuesta con [AUDIO].
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
