import { generarOrdenImagenologia } from './ordenImagenologia.js';

// ...

app.get('/pdf/:idPago', (req, res) => {
  const { idPago } = req.params;
  const datosPaciente = datosTemporales[idPago];

  if (!datosPaciente) {
    return res.status(404).json({ ok: false, error: 'Datos no encontrados para ese ID de pago' });
  }

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filename = `orden_${datosPaciente.nombre.replace(/ /g, '_')}.pdf`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  doc.pipe(res);
  generarOrdenImagenologia(doc, datosPaciente);
  doc.end();
});
