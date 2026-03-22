const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function run() {
  try {
    const models = await genAI.getGenerativeModel({model: 'gemini-2.5-flash'}).generateContent("hola");
    console.log("2.5-flash funciona:", models.response.text());
  } catch(e) {
    console.error("Error 2.5-flash:", e.message);
  }
}
run();
