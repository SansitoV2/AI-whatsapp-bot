const fs = require('fs');

const file = fs.readFileSync('src/ai.js', 'utf8');

const replacement = `
  // Limpiamos el historial para Gemini (El primer mensaje DEBE ser user y debe alternar)
  let historyForGemini = [];
  let lastRole = null;
  
  for (const msg of conversationHistory.slice(0, -1)) {
    const r = msg.role === 'assistant' ? 'model' : 'user';
    // Ignorar mensajes seguidos del mismo rol para no romper Gemini
    if (r !== lastRole) {
      historyForGemini.push({
        role: r,
        parts: [{ text: msg.content }]
      });
      lastRole = r;
    } else {
      // Si se repite el rol, concatenar al mensaje anterior en lugar de crear uno nuevo
      historyForGemini[historyForGemini.length - 1].parts[0].text += "\\n" + msg.content;
    }
  }

  // Asegurarnos de que el primer mensaje es user
  if (historyForGemini.length > 0 && historyForGemini[0].role !== 'user') {
    historyForGemini.shift(); 
  }
`;

const newFile = file.replace(/const historyForGemini = conversationHistory\.slice\(0, -1\)\.map\(msg => \(\{[\s\S]*?parts: \[\{ text: msg\.content \}\]\n  \}\)\);/, replacement.trim());

fs.writeFileSync('src/ai.js', newFile);
console.log('Done!');
