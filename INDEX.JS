const express = require("express");
const cors = require("cors");
const PDFDocument = require("pdfkit");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/generar-pdf", (req, res) => {
  const { nombre, edad, antecedentes, alergias, descripcionDolor } = req.body;

  const doc = new PDFDocument();
  res.setHeader("Content-Type", "application/pdf");

  // PDF directo al navegador
  doc.pipe(res);

  // Encabezado
  doc.fontSize(16).text("Instituto de Cirugía Articular", { align: "center" });
  doc.moveDown();
  doc.fontSize(14).text("Orden de Imagenología", { align: "center" });
  doc.moveDown();

  // Datos del paciente
  doc.fontSize(12).text(`Nombre: ${nombre}`);
  doc.text(`Edad: ${edad}`);
  doc.text(`Antecedentes: ${antecedentes}`);
  doc.text(`Alergias: ${alergias}`);
  doc.moveDown();

  // Determinar zona de dolor
  let tipoExamen = "Resonancia Magnética";
  let zona = "";
  let derivado = "";

  const dolor = descripcionDolor.toLowerCase();

  if (dolor.includes("rodilla")) {
    zona = "de Rodilla";
    derivado = "Dr. Jaime Espinoza";
  } else if (dolor.includes("cadera") || dolor.includes("inguinal")) {
    zona = "de Cadera";
    derivado = "Dr. Cristóbal Huerta";
  } else {
    zona = "según evaluación médica";
    derivado = "especialista a definir";
  }

  doc.text(`Se solicita: ${tipoExamen} ${zona}`);
  doc.moveDown();
  doc.text(`Favor acudir con el examen a consulta con: ${derivado}`);
  doc.moveDown();

  // Firma
  doc.text("_______________________", { align: "right" });
  doc.text("Firma y Timbre Médico", { align: "right" });

  doc.end();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
