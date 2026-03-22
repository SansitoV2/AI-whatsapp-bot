const { Groq } = require('groq-sdk');
const dotenv = require('dotenv');
dotenv.config();

const groq = new Groq(process.env.GROQ_API_KEY);

async function run() {
  try {
    const models = await groq.models.list();
    console.log(models.data.map(m => m.id));
  } catch(e) {
    console.error(e);
  }
}
run();
