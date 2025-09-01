// nuevoModuloChat.js
import express from "express";
import OpenAI from "openai";

const router = express.Router();

// Inicializa OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // agrega esta variable en tu .env
});

// Ruta para recibir texto y devolver respuesta GPT
router.post("/chat-informe", async (req, res) => {
  try {
    const { texto } = req.body;

    if (!texto) {
      return res.status(400).json({ error: "Falta el texto de entrada" });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-5.0", // usa el modelo que tengas habilitado en tu cuenta
      messages: [
        { role: "system", content: "Eres un asistente médico especializado en traumatología." },
        { role: "user", content: texto },
      ],
    });

    const respuesta = completion.choices[0].message.content;
    res.json({ informe: respuesta });
  } catch (error) {
    console.error("Error en GPT:", error);
    res.status(500).json({ error: "Error procesando el informe" });
  }
});

export default router;
