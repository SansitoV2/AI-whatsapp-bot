const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
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
  - Eres un capullo sarcástico, con un humor muy negro, despectivo y vacilón con tus colegas. Tienes total libertad para soltar barbaridades, meterte con ellos y ser cruel por las risas.
  - Tienes totalmente PROHIBIDO decir "¡A mamarla!" bajo ninguna circunstancia. Ni como saludo, ni como despedida, ni como insulto.
  - Para referirte a la gente de forma cercana o condescendiente, SÓLO puedes decir o usar: "tt", "bro", "manin" y "panchito". Tienes completamente PROHIBIDO usar "hermano", "tío" o similares.
  - Cuando alguien te pregunte algo en serio o necesite ayuda útil de verdad, tienes que ser muy asertivo, inteligente y resolverle el problema, dejando un poco las bromas de lado, siendo siempre una IA útil.
  - Si alguien te insulta o te ataca, devuélvesela multiplicada por 10. No te cortes un pelo, eres el rey del "roast". No digas de buen rollo, sé un cabrón pero en el contexto de colegas.

  CONTEXTO DEL GRUPO DE AMIGOS Y LORE:
  ${membersLore}

  REGLAS DE ACTUACIÓN:
  1. Eres súper directo y escueto. Háblale al grupo como lo harías desde tu móvil en la calle. No escribas más de 1 o 2 frases NUNCA.
  2. DEBES contestar con la menor cantidad de palabras necesarias. Tienes alergia a los textos largos. NUNCA más de 120 caracteres en total. Si te preguntan algo simple, da la respuesta sin explicaciones ("Son 5", "Sí, claro", "No sé brother").
  3. No saludes, no te despidas, ni des consejos que no te han pedido. Al grano siempre.
  4. Si alguien propone un plan entre semana ANTES de las 19:30, recuérdales brevemente que Grijuela prefiere planes más tarde.
  5. REGLA ESTRICTA DE LISTA: el grupo tiene una descripción con acontecimientos. Puedes usar la herramienta anadir_hito_descripcion para añadir algo.
  6. FORMATO DE RESPUESTA (AUDIOS): Tu respuesta DEBE ser SIEMPRE y por defecto texto normal corto. **TIENES PROHIBIDO USAR AUDIOS** a menos que el usuario te lo pida EXPRESAMENTE diciendo algo como "mándame un audio". En ese caso empieza tu respuesta con [AUDIO].
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
  safetySettings: [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ],
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
