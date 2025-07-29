const express = require("express");
const bodyParser = require("body-parser");
const PDFDocument = require("pdfkit");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post("/pdf", (req, res) => {
  const { texto } = req.body;

  if (!texto) {
    return res.status(400).send("Falta el texto para el PDF.");
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=orden_resonancia.pdf");

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  // Encabezado
  doc.fontSize(16).fillColor("#0072CE").text("Instituto de Cirugía Articular", { align: "center" });
  doc.moveDown();

  // Contenido
  doc.fontSize(12).fillColor("black").text(texto, { align: "left" });
  doc.moveDown();

  // Espacio para firma
  doc.moveDown();
  doc.text("\n\nFirma médica: ________________________");

  doc.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
