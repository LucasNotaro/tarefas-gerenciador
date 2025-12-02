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

const mapTaskRow = (row) => ({
  id: row.id,
  titulo: row.titulo,
  descricao: row.descricao,
  status: row.status,
  usuarioId: row.usuario_id,
  usuarioNome: row.usuario_nome,
  usuarioTelefone: row.usuario_telefone,
  criadoEm: row.criado_em,
});

const mapUserRow = (row) => ({
  id: row.id,
  nome: row.nome,
  telefone: row.telefone,
  criadoEm: row.criado_em,
});

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      telefone TEXT NOT NULL,
      criado_em TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descricao TEXT,
      status VARCHAR(30) DEFAULT 'pendente',
      usuario_id INTEGER REFERENCES users(id),
      criado_em TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'usuario_id'
      ) THEN
        ALTER TABLE tasks ADD COLUMN usuario_id INTEGER REFERENCES users(id);
      END IF;
    END
    $$;
  `);

  await pool.query(`ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'pendente';`);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'criador_nome'
      ) THEN
        ALTER TABLE tasks ALTER COLUMN criador_nome DROP NOT NULL;
      END IF;
    END
    $$;
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
      `SELECT t.*, u.nome AS usuario_nome, u.telefone AS usuario_telefone
       FROM tasks t
       LEFT JOIN users u ON u.id = t.usuario_id
       ORDER BY t.criado_em DESC, t.id DESC`
    );
    res.json(rows.map(mapTaskRow));
  } catch (error) {
    res.status(500).json({ erro: 'Não foi possível listar as tarefas.', detalhe: error.message });
  }
});

app.get('/tasks/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, u.nome AS usuario_nome, u.telefone AS usuario_telefone
       FROM tasks t
       LEFT JOIN users u ON u.id = t.usuario_id
       WHERE t.id = $1
       LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    res.json(mapTaskRow(rows[0]));
  } catch (error) {
    res.status(400).json({ erro: 'ID inválido ou inexistente.', detalhe: error.message });
  }
});

app.post('/tasks', async (req, res) => {
  try {
    const { titulo, descricao = '', usuarioId } = req.body || {};
    if (!titulo?.trim() || !usuarioId) {
      return res.status(400).json({ erro: 'Informe título e atribua a tarefa a um usuário.' });
    }

    const usuario = await pool.query('SELECT id FROM users WHERE id = $1', [usuarioId]);
    if (!usuario.rowCount) {
      return res.status(400).json({ erro: 'Usuário informado não existe.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO tasks (titulo, descricao, status, usuario_id)
       VALUES ($1, $2, 'pendente', $3)
       RETURNING *`,
      [titulo.trim(), descricao, usuarioId]
    );
    const tarefaCriada = await pool.query(
      `SELECT t.*, u.nome AS usuario_nome, u.telefone AS usuario_telefone
       FROM tasks t
       LEFT JOIN users u ON u.id = t.usuario_id
       WHERE t.id = $1`,
      [rows[0].id]
    );
    res.status(201).json(mapTaskRow(tarefaCriada.rows[0]));
  } catch (error) {
    res.status(400).json({ erro: 'Falha ao criar tarefa.', detalhe: error.message });
  }
});

app.put('/tasks/:id', async (req, res) => {
  try {
    const { titulo, descricao = '', status, usuarioId } = req.body || {};

    if (!titulo?.trim()) {
      return res.status(400).json({ erro: 'Informe o título da tarefa.' });
    }

    const tarefaExistente = await pool.query(
      'SELECT id, usuario_id, status FROM tasks WHERE id = $1',
      [req.params.id]
    );
    if (!tarefaExistente.rowCount) {
      return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    }

    const usuarioDestino = usuarioId ?? tarefaExistente.rows[0].usuario_id;
    if (!usuarioDestino) {
      return res.status(400).json({ erro: 'A tarefa precisa estar atribuída a um usuário.' });
    }

    const usuario = await pool.query('SELECT id FROM users WHERE id = $1', [usuarioDestino]);
    if (!usuario.rowCount) {
      return res.status(400).json({ erro: 'Usuário informado não existe.' });
    }

    const statusLimpo = status?.trim().toLowerCase();
    if (statusLimpo && !['pendente', 'concluida'].includes(statusLimpo)) {
      return res.status(400).json({ erro: 'Status inválido.' });
    }

    const { rows } = await pool.query(
      `UPDATE tasks
       SET titulo = $1,
           descricao = $2,
           status = $3,
           usuario_id = $4
       WHERE id = $5
       RETURNING *`,
      [
        titulo.trim(),
        descricao,
        statusLimpo || tarefaExistente.rows[0].status,
        usuarioDestino,
        req.params.id,
      ]
    );

    if (!rows.length) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    const tarefaAtualizada = await pool.query(
      `SELECT t.*, u.nome AS usuario_nome, u.telefone AS usuario_telefone
       FROM tasks t
       LEFT JOIN users u ON u.id = t.usuario_id
       WHERE t.id = $1`,
      [rows[0].id]
    );
    res.json(mapTaskRow(tarefaAtualizada.rows[0]));
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

app.get('/users', async (_, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY nome ASC');
    res.json(rows.map(mapUserRow));
  } catch (error) {
    res.status(500).json({ erro: 'Não foi possível listar os usuários.', detalhe: error.message });
  }
});

app.post('/users', async (req, res) => {
  try {
    const { nome, telefone } = req.body || {};
    if (!nome?.trim() || !telefone?.trim()) {
      return res.status(400).json({ erro: 'Informe nome e telefone do usuário.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO users (nome, telefone)
       VALUES ($1, $2)
       RETURNING *`,
      [nome.trim(), telefone.trim()]
    );
    res.status(201).json(mapUserRow(rows[0]));
  } catch (error) {
    res.status(400).json({ erro: 'Falha ao criar usuário.', detalhe: error.message });
  }
});

app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`);
});
