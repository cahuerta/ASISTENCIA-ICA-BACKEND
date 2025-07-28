import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.post('/api/ordenes', (req, res) => {
  const { nombre, edad, descripcion } = req.body;

  if (!nombre || !edad || !descripcion) {
    return res.status(400).json({ mensaje: 'Faltan datos requeridos' });
  }

  // Lógica simple para sugerir exámenes
  let examenes = [];
  const desc = descripcion.toLowerCase();

  if (desc.includes('rodilla')) {
    examenes.push('Resonancia de rodilla');
  }
  if (desc.includes('cadera') || desc.includes('inguinal')) {
    examenes.push('Resonancia de cadera');
  }
  if (examenes.length === 0) {
    examenes.push('Radiografía simple');
  }

  res.json({
    mensaje: 'Orden generada con éxito',
    orden: {
      paciente: nombre,
      edad,
      examenes,
    }
  });
});

app.listen(port, () => {
  console.log(`Servidor corriendo en puerto ${port}`);
});
