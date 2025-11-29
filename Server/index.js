require('dotenv').config();

const express = require('express');
const bodyparser = require('body-parser');
const cors = require('cors');
const methodOverride = require('method-override');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(methodOverride('X-HTTP-Method'));
app.use(methodOverride('X-HTTP-Method-Override'));
app.use(methodOverride('X-Method-Override'));
app.use(methodOverride('_method'));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  next();
});

app.use(bodyparser.json());
app.use(bodyparser.urlencoded({ extended: false }));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL não foi definido. Configure a variável de ambiente no arquivo .env.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const mapRow = (row) => ({
  id: row.id,
  titulo: row.titulo,
  descricao: row.descricao,
  status: row.status,
  criadorNome: row.criador_nome,
  criadorEmail: row.criador_email,
  criadoEm: row.criado_em,
});

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descricao TEXT,
      status VARCHAR(30) DEFAULT 'aberta',
      criador_nome TEXT NOT NULL,
      criador_email TEXT,
      criado_em TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

ensureTables()
  .then(() => console.log('Tabela de tarefas disponível.'))
  .catch((err) => {
    console.error('Erro ao preparar banco.', err);
    process.exit(1);
  });

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.get('/tasks', async (_, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM tasks ORDER BY criado_em DESC, id DESC'
    );
    res.json(rows.map(mapRow));
  } catch (error) {
    res.status(500).json({ erro: 'Não foi possível listar as tarefas.', detalhe: error.message });
  }
});

app.get('/tasks/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1 LIMIT 1', [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    res.json(mapRow(rows[0]));
  } catch (error) {
    res.status(400).json({ erro: 'ID inválido ou inexistente.', detalhe: error.message });
  }
});

app.post('/tasks', async (req, res) => {
  try {
    const { titulo, descricao = '', status = 'aberta', criadorNome, criadorEmail = '' } =
      req.body || {};
    if (!titulo?.trim() || !criadorNome?.trim()) {
      return res.status(400).json({ erro: 'Informe título e o nome de quem criou a tarefa.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO tasks (titulo, descricao, status, criador_nome, criador_email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [titulo.trim(), descricao, status.trim() || 'aberta', criadorNome.trim(), criadorEmail.trim()]
    );
    res.status(201).json(mapRow(rows[0]));
  } catch (error) {
    res.status(400).json({ erro: 'Falha ao criar tarefa.', detalhe: error.message });
  }
});

app.put('/tasks/:id', async (req, res) => {
  try {
    const { titulo, descricao = '', status = 'aberta', criadorNome, criadorEmail = '' } =
      req.body || {};

    if (!titulo?.trim() || !criadorNome?.trim()) {
      return res.status(400).json({ erro: 'Informe título e o nome de quem criou a tarefa.' });
    }

    const { rows } = await pool.query(
      `UPDATE tasks
       SET titulo = $1,
           descricao = $2,
           status = $3,
           criador_nome = $4,
           criador_email = $5
       WHERE id = $6
       RETURNING *`,
      [
        titulo.trim(),
        descricao,
        status.trim() || 'aberta',
        criadorNome.trim(),
        criadorEmail.trim(),
        req.params.id,
      ]
    );

    if (!rows.length) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    res.json(mapRow(rows[0]));
  } catch (error) {
    res.status(400).json({ erro: 'Falha ao atualizar tarefa.', detalhe: error.message });
  }
});

app.delete('/tasks/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    res.json({ status: 'removida' });
  } catch (error) {
    res.status(400).json({ erro: 'Falha ao excluir tarefa.', detalhe: error.message });
  }
});

app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`);
});
