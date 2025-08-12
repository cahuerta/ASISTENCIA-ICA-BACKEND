const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3001;
const SHEET_ID = process.env.SHEET_ID;

// ========= AUTH Google con JSON único en ENV =========
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error('Falta GOOGLE_SERVICE_ACCOUNT_JSON en las variables de entorno');
}

let credentials = {};
try {
  credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
} catch (e) {
  console.error('GOOGLE_SERVICE_ACCOUNT_JSON inválido:', e);
}

const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
const jwt = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key,
  scopes
);
const sheets = google.sheets({ version: 'v4', auth: jwt });

// Helper para escribir una fila
async function appendRow(tabName, values) {
  return sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  });
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// ===== DEBUG: probar autenticación (TEMPORAL) =====
app.get('/_debug/auth', async (_req, res) => {
  try {
    const { token } = await jwt.getAccessToken(); // fuerza intercambio JWT
    res.json({
      ok: true,
      email: credentials.client_email || null,
      tokenSample: token ? String(token).slice(-12) : null
    });
  } catch (e) {
    console.error('Auth debug error:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ===== DEBUG: probar escritura en "Pacientes" (TEMPORAL) =====
app.get('/_debug/append', async (_req, res) => {
  try {
    const ts = new Date().toISOString();
    const r = await appendRow('Pacientes', [ts, 'TEST', '111', '22', 'Rodilla', 'Derecha']);
    res.json({ ok: true, updatedRange: r.data?.updates?.updatedRange || null });
  } catch (e) {
    console.error('Append debug error:', e?.response?.data || e);
    res.status(500).json({
      ok: false,
      message: e.message,
      details: e?.response?.data || null
    });
  }
});

// ========= PACIENTES =========
// Columnas: timestamp | nombre | rut | edad | dolor | lado
app.post('/api/pacientes', async (req, res) => {
  try {
    const { nombre, rut, edad, dolor, lado } = req.body || {};
    if (!nombre || !rut || !edad || !dolor || !lado) {
      return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios' });
    }
    const timestamp = new Date().toISOString();
    const row = [timestamp, String(nombre), String(rut), String(edad), String(dolor), String(lado)];
    await appendRow('Pacientes', row);
    res.json({ ok: true });
  } catch (e) {
    console.error('Pacientes error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========= TRAUMATOLOGO =========
// Columnas: timestamp | pacienteNombre | rut | edad | examenSolicitado | nombreMedico | especialidad
app.post('/api/traumatologo', async (req, res) => {
  try {
    const { pacienteNombre, rut, edad, examenSolicitado, nombreMedico } = req.body || {};
    if (!pacienteNombre || !rut || !edad || !examenSolicitado || !nombreMedico) {
      return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios' });
    }
    const timestamp = new Date().toISOString();
    const especialidad = 'Traumatólogo';
    const row = [
      timestamp,
      String(pacienteNombre),
      String(rut),
      String(edad),
      String(examenSolicitado),
      String(nombreMedico),
      especialidad
    ];
    await appendRow('Traumatologo', row);
    res.json({ ok: true });
  } catch (e) {
    console.error('Traumatologo error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ========= MEDICO GENERAL =========
// Columnas: timestamp | pacienteNombre | rut | edad | examenSolicitado | nombreMedico | especialidad
app.post('/api/medico-general', async (req, res) => {
  try {
    const { pacienteNombre, rut, edad, examenSolicitado, nombreMedico } = req.body || {};
    if (!pacienteNombre || !rut || !edad || !examenSolicitado || !nombreMedico) {
      return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios' });
    }
    const timestamp = new Date().toISOString();
    const especialidad = 'Medicina general';
    const row = [
      timestamp,
      String(pacienteNombre),
      String(rut),
      String(edad),
      String(examenSolicitado),
      String(nombreMedico),
      especialidad
    ];
    await appendRow('MedicoGeneral', row);
    res.json({ ok: true });
  } catch (e) {
    console.error('MedicoGeneral error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});
