import { StatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  FlatList,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar as RNStatusBar } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.0.194:3000';

let db = null;
let sqliteHasCriadorColumn = null;

const detectarColunaCriador = async (database) => {
  if (sqliteHasCriadorColumn !== null) return sqliteHasCriadorColumn;
  const info = await database.getAllAsync("PRAGMA table_info('tasks');");
  sqliteHasCriadorColumn = info.some((c) => c.name === 'criador_nome');
  return sqliteHasCriadorColumn;
};

const formatarTelefone = (valor) => {
  const digits = valor.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const ensureSQLiteSchema = async (database) => {
  await database.execAsync('PRAGMA foreign_keys = ON;');
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      telefone TEXT NOT NULL,
      criado_em TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      descricao TEXT,
      status TEXT DEFAULT 'pendente',
      usuario_id INTEGER REFERENCES users(id),
      criado_em TEXT DEFAULT (datetime('now'))
    );
  `);

  const colunaUsuario = await database.getFirstAsync(
    "SELECT name FROM pragma_table_info('tasks') WHERE name = 'usuario_id';"
  );
  if (!colunaUsuario) {
    await database.execAsync("ALTER TABLE tasks ADD COLUMN usuario_id INTEGER REFERENCES users(id);");
  }
  const info = await database.getAllAsync("PRAGMA table_info('tasks');");
  sqliteHasCriadorColumn = info.some((c) => c.name === 'criador_nome');
  await database.execAsync(
    "UPDATE tasks SET status = 'pendente' WHERE status IS NULL OR status = ''"
  );
};

const getDatabase = async () => {
  if (!db) {
    try {
      db = await SQLite.openDatabaseAsync('tarefas.db');
      await ensureSQLiteSchema(db);
    } catch (error) {
      console.error('Erro ao abrir banco de dados:', error);
      throw error;
    }
  }
  return db;
};

const mapSqliteTaskRow = (row) => ({
  id: row.id,
  titulo: row.titulo,
  descricao: row.descricao ?? '',
  status: row.status ?? 'pendente',
  usuarioId: row.usuario_id ?? null,
  usuarioNome: row.usuario_nome ?? '',
  usuarioTelefone: row.usuario_telefone ?? '',
  criadoEm: row.criado_em ?? '',
});

const mapSqliteUserRow = (row) => ({
  id: row.id,
  nome: row.nome,
  telefone: row.telefone,
  criadoEm: row.criado_em ?? '',
});

const listarSQLite = async () => {
  try {
    const database = await getDatabase();
    const result = await database.getAllAsync(
      `SELECT t.*, u.nome AS usuario_nome, u.telefone AS usuario_telefone
       FROM tasks t
       LEFT JOIN users u ON u.id = t.usuario_id
       ORDER BY datetime(coalesce(t.criado_em, current_timestamp)) DESC, t.id DESC`
    );
    return result.map(mapSqliteTaskRow);
  } catch (error) {
    console.error('Erro ao listar tarefas:', error);
    throw error;
  }
};

const listarUsuariosSQLite = async () => {
  try {
    const database = await getDatabase();
    const result = await database.getAllAsync(
      'SELECT * FROM users ORDER BY nome ASC, id DESC'
    );
    return result.map(mapSqliteUserRow);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    throw error;
  }
};

const obterSQLite = async (id) => {
  try {
    const database = await getDatabase();
    const result = await database.getFirstAsync(
      `SELECT t.*, u.nome AS usuario_nome, u.telefone AS usuario_telefone
       FROM tasks t
       LEFT JOIN users u ON u.id = t.usuario_id
       WHERE t.id = ?`,
      [id]
    );
    return result ? mapSqliteTaskRow(result) : null;
  } catch (error) {
    console.error('Erro ao obter tarefa:', error);
    throw error;
  }
};

const inserirSQLite = async ({ titulo, descricao, usuarioId }) => {
  try {
    const database = await getDatabase();
    const temCriador = await detectarColunaCriador(database);
    const usuario = await database.getFirstAsync('SELECT id FROM users WHERE id = ?', [usuarioId]);
    if (!usuario) {
      throw new Error('Usuário não encontrado para atribuição.');
    }
    const colunasExtras = temCriador ? ', criador_nome, criador_email' : '';
    const valoresExtras = temCriador ? ', ?, ?' : '';
    const params = temCriador
      ? [titulo, descricao, usuarioId, '', '']
      : [titulo, descricao, usuarioId];

    const result = await database.runAsync(
      `INSERT INTO tasks (titulo, descricao, status, usuario_id, criado_em${colunasExtras})
       VALUES (?, ?, 'pendente', ?, datetime('now', 'localtime')${valoresExtras})`,
      params
    );
    return obterSQLite(result.lastInsertRowId);
  } catch (error) {
    console.error('Erro ao inserir tarefa:', error);
    throw error;
  }
};

const atualizarSQLite = async (id, { titulo, descricao, status, usuarioId }) => {
  try {
    const database = await getDatabase();
    const tarefa = await database.getFirstAsync('SELECT status, usuario_id FROM tasks WHERE id = ?', [
      id,
    ]);
    if (!tarefa) {
      return null;
    }

    const usuarioDestino = usuarioId ?? tarefa.usuario_id;
    const usuario = await database.getFirstAsync('SELECT id FROM users WHERE id = ?', [
      usuarioDestino,
    ]);
    if (!usuario) {
      throw new Error('Usuário não encontrado para atribuição.');
    }

    const statusParaSalvar = status?.trim().toLowerCase() || tarefa.status || 'pendente';
    if (!['pendente', 'concluida'].includes(statusParaSalvar)) {
      throw new Error('Status inválido.');
    }
    await database.runAsync(
      `UPDATE tasks
       SET titulo = ?, descricao = ?, status = ?, usuario_id = ?
       WHERE id = ?`,
      [titulo, descricao, statusParaSalvar, usuarioDestino, id]
    );
    return obterSQLite(id);
  } catch (error) {
    console.error('Erro ao atualizar tarefa:', error);
    throw error;
  }
};

const excluirSQLite = async (id) => {
  try {
    const database = await getDatabase();
    await database.runAsync('DELETE FROM tasks WHERE id = ?', [id]);
  } catch (error) {
    console.error('Erro ao excluir tarefa:', error);
    throw error;
  }
};

const inserirUsuarioSQLite = async ({ nome, telefone }) => {
  try {
    const database = await getDatabase();
    const result = await database.runAsync(
      `INSERT INTO users (nome, telefone, criado_em)
       VALUES (?, ?, datetime('now', 'localtime'))`,
      [nome, telefone]
    );
    const criado = await database.getFirstAsync('SELECT * FROM users WHERE id = ?', [
      result.lastInsertRowId,
    ]);
    return criado ? mapSqliteUserRow(criado) : null;
  } catch (error) {
    console.error('Erro ao inserir usuário:', error);
    throw error;
  }
};

const fetchJson = async (url, options = {}) => {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    let message = '';
    try {
      const body = await resp.json();
      message = body?.erro || body?.message || '';
    } catch (err) {
      message = await resp.text();
    }
    throw new Error(message || 'Erro na API');
  }
  return resp.json();
};

const listarPostgres = () => fetchJson(`${API_URL}/tasks`);
const inserirPostgres = (payload) =>
  fetchJson(`${API_URL}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
const atualizarPostgres = (id, payload) =>
  fetchJson(`${API_URL}/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
const excluirPostgres = (id) =>
  fetchJson(`${API_URL}/tasks/${id}`, {
    method: 'DELETE',
  });

const listarUsuariosPostgres = () => fetchJson(`${API_URL}/users`);
const inserirUsuarioPostgres = (payload) =>
  fetchJson(`${API_URL}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });

/* ===================== COMPONENTES ===================== */

function Splash() {
  return (
    <View style={styles.splashContainer}>
      <Image source={require('./assets/splash-icon.png')} style={styles.splashImage} />
      <Text style={styles.splashText}>Gerenciador de Tarefas</Text>
    </View>
  );
}

function SeletorBanco({ onSelecionar }) {
  return (
    <View style={styles.selectorContainer}>
      <Text style={styles.title}>Escolha onde salvar as tarefas</Text>
      <Text style={styles.selectorSubtitle}>
        Você pode alternar sempre que quiser. Os dados não são compartilhados entre os bancos.
      </Text>
      <TouchableOpacity style={styles.selectorButton} onPress={() => onSelecionar('sqlite')}>
        <Text style={styles.selectorButtonText}>SQLite (local)</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.selectorButton} onPress={() => onSelecionar('postgres')}>
        <Text style={styles.selectorButtonText}>Postgres (Neon)</Text>
      </TouchableOpacity>
    </View>
  );
}

function Lista({
  tarefas,
  carregando,
  fonteLabel,
  onTrocarBanco,
  onGerenciarUsuarios,
  onVer,
  onEditar,
  onExcluir,
  onNovo,
}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Tarefas</Text>
          <Text style={styles.subtitle}>Banco: {fonteLabel}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={styles.switchBtn} onPress={onGerenciarUsuarios}>
            <Text style={styles.switchBtnText}>Usuários</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.switchBtn} onPress={onTrocarBanco}>
            <Text style={styles.switchBtnText}>Trocar banco</Text>
          </TouchableOpacity>
        </View>
      </View>

      {carregando && <Text style={styles.loading}>Carregando...</Text>}

      <FlatList
        data={tarefas}
        keyExtractor={(item, index) => (item?.id ? String(item.id) : String(index))}
        contentContainerStyle={{ gap: 10, padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.titulo}</Text>
            <Text style={styles.cardSub}>Status: {item.status}</Text>
            <Text style={styles.cardSub}>Responsável: {item.usuarioNome || '-'}</Text>
            <Text style={styles.cardSub}>Telefone: {item.usuarioTelefone || '-'}</Text>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.btn} onPress={() => onVer(item)}>
                <Text style={styles.btnText}>Ver</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={() => onEditar(item)}>
                <Text style={styles.btnText}>Editar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnDanger]}
                onPress={() => onExcluir(item.id)}
              >
                <Text style={styles.btnText}>Excluir</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#777', marginTop: 24 }}>
            Nenhuma tarefa cadastrada ainda.
          </Text>
        }
      />

      <View style={styles.footer}>
        <Button title="Adicionar tarefa" onPress={onNovo} />
      </View>
      <StatusBar style="dark" />
    </View>
  );
}

function Form({ form, setForm, usuarios, onSalvar, onCancelar, onGerenciarUsuarios, styles }) {
  const [mostrandoUsuarios, setMostrandoUsuarios] = useState(false);
  const usuarioSelecionado = usuarios.find((u) => u.id === form.usuarioId);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{form.id ? 'Editar tarefa' : 'Nova tarefa'}</Text>
      <View style={styles.form}>
        <TextInput
          placeholder="Título"
          style={styles.input}
          value={form.titulo}
          onChangeText={(v) => setForm((prev) => ({ ...prev, titulo: v }))}
        />
        <TextInput
          placeholder="Descrição"
          style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
          multiline
          value={form.descricao}
          onChangeText={(v) => setForm((prev) => ({ ...prev, descricao: v }))}
        />

        <TouchableOpacity
          style={styles.selectorInput}
          onPress={() => setMostrandoUsuarios(true)}
          disabled={!usuarios.length}
        >
          <Text style={{ color: usuarioSelecionado ? '#000' : '#777' }}>
            {usuarioSelecionado
              ? `${usuarioSelecionado.nome} (${usuarioSelecionado.telefone})`
              : 'Selecione um usuário'}
          </Text>
        </TouchableOpacity>
        {!usuarios.length && (
          <Text style={styles.helperText}>Cadastre um usuário antes de criar tarefas.</Text>
        )}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Button title="Salvar" onPress={onSalvar} />
          <Button title="Cancelar" color="#888" onPress={onCancelar} />
        </View>
        <View style={{ marginTop: 12 }}>
          <Button title="Gerenciar usuários" color="#222" onPress={onGerenciarUsuarios} />
        </View>
      </View>

      <Modal
        visible={mostrandoUsuarios}
        transparent
        animationType="slide"
        onRequestClose={() => setMostrandoUsuarios(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Escolha um usuário</Text>
            <FlatList
              data={usuarios}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.userOption}
                  onPress={() => {
                    setForm((prev) => ({ ...prev, usuarioId: item.id }));
                    setMostrandoUsuarios(false);
                  }}
                >
                  <Text style={styles.bold}>{item.nome}</Text>
                  <Text style={styles.cardSub}>{item.telefone}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={{ textAlign: 'center', color: '#666' }}>Nenhum usuário cadastrado.</Text>
              }
            />
            <Button title="Fechar" onPress={() => setMostrandoUsuarios(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Detalhe({ tarefa, onVoltar, onConcluir, styles }) {
  if (!tarefa) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Detalhes</Text>
      <View style={styles.form}>
        <Text style={styles.detail}>
          <Text style={styles.bold}>Título:</Text> {tarefa.titulo}
        </Text>
        <Text style={styles.detail}>
          <Text style={styles.bold}>Descrição:</Text> {tarefa.descricao || '-'}
        </Text>
        <Text style={styles.detail}>
          <Text style={styles.bold}>Status:</Text> {tarefa.status}
        </Text>
        <Text style={styles.detail}>
          <Text style={styles.bold}>Responsável:</Text> {tarefa.usuarioNome || '-'}
        </Text>
        <Text style={styles.detail}>
          <Text style={styles.bold}>Telefone:</Text> {tarefa.usuarioTelefone || '-'}
        </Text>
        <Text style={styles.detail}>
          <Text style={styles.bold}>Criado em:</Text> {tarefa.criadoEm || '-'}
        </Text>
        {tarefa.status !== 'concluida' && (
          <View style={{ marginBottom: 8 }}>
            <Button title="Marcar como concluída" color="#1b5e20" onPress={() => onConcluir(tarefa)} />
          </View>
        )}
        <Button title="Voltar" onPress={onVoltar} />
      </View>
    </View>
  );
}

function Usuarios({ usuarios, novoUsuario, setNovoUsuario, onSalvar, onVoltar, styles }) {
  return (
    <View style={styles.container}>
      <View style={[styles.header, styles.usersHeader]}>
        <View>
          <Text style={styles.title}>Usuários</Text>
          <Text style={styles.subtitle}>Gerencie responsáveis das tarefas</Text>
        </View>
        <TouchableOpacity style={styles.switchBtn} onPress={onVoltar}>
          <Text style={styles.switchBtnText}>Voltar</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.form}>
        <Text style={styles.subtitle}>Cadastrar usuário</Text>
        <TextInput
          placeholder="Nome"
          style={styles.input}
          value={novoUsuario.nome}
          onChangeText={(v) => setNovoUsuario((prev) => ({ ...prev, nome: v }))}
        />
        <TextInput
          placeholder="Telefone"
          style={styles.input}
          value={novoUsuario.telefone}
          keyboardType="phone-pad"
          onChangeText={(v) =>
            setNovoUsuario((prev) => ({ ...prev, telefone: formatarTelefone(v) }))
          }
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Button title="Salvar usuário" onPress={onSalvar} />
          <Button title="Voltar" color="#888" onPress={onVoltar} />
        </View>
      </View>

      <Text style={[styles.title, { fontSize: 18, marginHorizontal: 16, marginTop: 16 }]}>
        Cadastrados
      </Text>
      <FlatList
        data={usuarios}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ gap: 10, padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.nome}</Text>
            <Text style={styles.cardSub}>{item.telefone}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#777', marginTop: 12 }}>
            Nenhum usuário cadastrado ainda.
          </Text>
        }
      />
    </View>
  );
}

/* ===================== APP ===================== */

export default function App() {
  const [tela, setTela] = useState('lista');
  const [tarefas, setTarefas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [novoUsuario, setNovoUsuario] = useState({ nome: '', telefone: '' });
  const [fonteDados, setFonteDados] = useState(null); // 'sqlite' | 'postgres'
  const [carregando, setCarregando] = useState(false);
  const [selecionada, setSelecionada] = useState(null);
  const [mostrandoSplash, setMostrandoSplash] = useState(true);
  const [form, setForm] = useState({
    id: null,
    titulo: '',
    descricao: '',
    status: 'pendente',
    usuarioId: null,
  });

  useEffect(() => {
    const inicializar = async () => {
      try {
        await getDatabase();
      } catch (error) {
        console.error('Erro ao preparar o banco SQLite', error);
        Alert.alert('SQLite', 'Não foi possível preparar o banco de dados local.');
      }
    };

    inicializar();
    const timeout = setTimeout(() => setMostrandoSplash(false), 1200);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!fonteDados) return;
    carregarUsuarios();
    carregarTarefas();
  }, [fonteDados]);

  useEffect(() => {
    if (!form.usuarioId && usuarios.length) {
      setForm((prev) => ({ ...prev, usuarioId: prev.usuarioId ?? usuarios[0].id }));
    }
  }, [usuarios]);

  const carregarUsuarios = async () => {
    if (!fonteDados) return;
    try {
      const data =
        fonteDados === 'sqlite' ? await listarUsuariosSQLite() : await listarUsuariosPostgres();
      setUsuarios(data);
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
      Alert.alert('Erro', 'Não foi possível carregar os usuários.');
    }
  };

  const carregarTarefas = async () => {
    if (!fonteDados) return;
    setCarregando(true);
    try {
      const data =
        fonteDados === 'sqlite' ? await listarSQLite() : await listarPostgres();
      setTarefas(data);
    } catch (error) {
      console.error('Erro ao carregar tarefas:', error);
      Alert.alert('Erro', 'Não foi possível carregar as tarefas.');
    } finally {
      setCarregando(false);
    }
  };

  const limparForm = () => {
    setForm({
      id: null,
      titulo: '',
      descricao: '',
      status: 'pendente',
      usuarioId: usuarios[0]?.id ?? null,
    });
  };

  const abrirFormCriar = () => {
    if (!usuarios.length) {
      return Alert.alert('Usuários', 'Cadastre um usuário antes de criar tarefas.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Ir para usuários', onPress: () => setTela('usuarios') },
      ]);
    }
    limparForm();
    setSelecionada(null);
    setTela('form');
  };

  const abrirFormEditar = (tarefa) => {
    setForm({
      id: tarefa.id,
      titulo: tarefa.titulo,
      descricao: tarefa.descricao ?? '',
      status: tarefa.status ?? 'pendente',
      usuarioId: tarefa.usuarioId ?? null,
    });
    setTela('form');
  };

  const abrirDetalhe = (tarefa) => {
    setSelecionada(tarefa);
    setTela('detalhe');
  };

  const salvar = async () => {
    if (!fonteDados) return;
    if (!form.titulo.trim()) {
      return Alert.alert('Atenção', 'Informe o título da tarefa.');
    }
    if (!form.usuarioId) {
      return Alert.alert('Atenção', 'Selecione um usuário para atribuir a tarefa.');
    }

    const payload = {
      titulo: form.titulo.trim(),
      descricao: form.descricao.trim(),
      status: form.status || 'pendente',
      usuarioId: form.usuarioId,
    };

    try {
      if (fonteDados === 'sqlite') {
        if (form.id) {
          await atualizarSQLite(form.id, payload);
        } else {
          await inserirSQLite(payload);
        }
      } else {
        if (form.id) {
          await atualizarPostgres(form.id, payload);
        } else {
          await inserirPostgres(payload);
        }
      }
      await carregarTarefas();
      setTela('lista');
      limparForm();
    } catch (error) {
      console.error('Erro ao salvar tarefa:', error);
      Alert.alert('Erro', 'Não foi possível salvar a tarefa.');
    }
  };

  const excluirTarefa = async (id) => {
    if (!fonteDados) return;
    try {
      if (fonteDados === 'sqlite') {
        await excluirSQLite(id);
      } else {
        await excluirPostgres(id);
      }
      await carregarTarefas();
    } catch (error) {
      console.error('Erro ao excluir tarefa:', error);
      Alert.alert('Erro', 'Falha ao excluir a tarefa.');
    }
  };

  const concluirTarefa = async (tarefa) => {
    if (!fonteDados) return;
    try {
      const payload = {
        titulo: tarefa.titulo,
        descricao: tarefa.descricao ?? '',
        status: 'concluida',
        usuarioId: tarefa.usuarioId,
      };
      if (fonteDados === 'sqlite') {
        await atualizarSQLite(tarefa.id, payload);
      } else {
        await atualizarPostgres(tarefa.id, payload);
      }
      await carregarTarefas();
      setSelecionada((prev) =>
        prev && prev.id === tarefa.id ? { ...prev, status: 'concluida' } : prev
      );
    } catch (error) {
      console.error('Erro ao concluir tarefa:', error);
      Alert.alert('Erro', 'Não foi possível alterar o status.');
    }
  };

  const salvarUsuario = async () => {
    if (!fonteDados) return;
    if (!novoUsuario.nome.trim() || !novoUsuario.telefone.trim()) {
      return Alert.alert('Atenção', 'Informe nome e telefone.');
    }
    const telefoneLimpo = novoUsuario.telefone.replace(/\D/g, '');
    if (telefoneLimpo.length < 8) {
      return Alert.alert('Atenção', 'Informe um telefone válido (mínimo 8 dígitos).');
    }
    const payload = {
      nome: novoUsuario.nome.trim(),
      telefone: novoUsuario.telefone.trim(),
    };
    try {
      if (fonteDados === 'sqlite') {
        await inserirUsuarioSQLite(payload);
      } else {
        await inserirUsuarioPostgres(payload);
      }
      setNovoUsuario({ nome: '', telefone: '' });
      await carregarUsuarios();
    } catch (error) {
      console.error('Erro ao salvar usuário:', error);
      Alert.alert('Erro', 'Não foi possível salvar o usuário.');
    }
  };

  const fonteLabel =
    fonteDados === 'sqlite' ? 'SQLite (local)' : 'Postgres (Neon)';

  const voltarSelecaoBanco = () => {
    setFonteDados(null);
    setTarefas([]);
    setUsuarios([]);
    setNovoUsuario({ nome: '', telefone: '' });
    setForm({ id: null, titulo: '', descricao: '', status: 'pendente', usuarioId: null });
    setTela('lista');
    setSelecionada(null);
  };

  if (mostrandoSplash) {
    return <Splash />;
  }

  if (!fonteDados) {
    return <SeletorBanco onSelecionar={setFonteDados} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={{ flex: 1 }}>
      {tela === 'lista' && (
        <Lista
          tarefas={tarefas}
          carregando={carregando}
          fonteLabel={fonteLabel}
          onTrocarBanco={voltarSelecaoBanco}
          onGerenciarUsuarios={() => setTela('usuarios')}
          onVer={abrirDetalhe}
          onEditar={abrirFormEditar}
          onExcluir={excluirTarefa}
          onNovo={abrirFormCriar}
        />
      )}

      {tela === 'form' && (
        <Form
          form={form}
          setForm={setForm}
          usuarios={usuarios}
          onSalvar={salvar}
          onCancelar={() => setTela('lista')}
          onGerenciarUsuarios={() => setTela('usuarios')}
          styles={styles}
        />
      )}

      {tela === 'detalhe' && (
        <Detalhe
          tarefa={selecionada}
          onVoltar={() => setTela('lista')}
          onConcluir={concluirTarefa}
          styles={styles}
        />
      )}

      {tela === 'usuarios' && (
        <Usuarios
          usuarios={usuarios}
          novoUsuario={novoUsuario}
          setNovoUsuario={setNovoUsuario}
          onSalvar={salvarUsuario}
          onVoltar={() => setTela('lista')}
          styles={styles}
        />
      )}
      </View>
    </SafeAreaView>
  );
}

/* ===================== STYLES ===================== */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) : 0,
  },
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 22, fontWeight: '600' },
  subtitle: { color: '#555', marginTop: 2 },
  form: { paddingHorizontal: 16, gap: 12, paddingTop: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10 },
  selectorInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fafafa',
  },
  helperText: { color: '#b71c1c' },
  card: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    backgroundColor: '#fafafa',
  },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardSub: { color: '#555', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { backgroundColor: '#222', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  btnDanger: { backgroundColor: '#b71c1c' },
  btnText: { color: '#fff' },
  detail: { marginBottom: 8, fontSize: 16 },
  bold: { fontWeight: '600' },
  footer: { padding: 16 },
  loading: { textAlign: 'center', color: '#666' },
  switchBtn: {
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  switchBtnText: { color: '#222', fontWeight: '500' },
  splashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  splashImage: { width: 160, height: 160, marginBottom: 24 },
  splashText: { fontSize: 20, fontWeight: '600' },
  selectorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
    gap: 16,
  },
  selectorSubtitle: { textAlign: 'center', color: '#555' },
  selectorButton: {
    width: '100%',
    backgroundColor: '#222',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  selectorButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  screenTitle: { paddingHorizontal: 16, paddingTop: 12 },
  usersHeader: { paddingBottom: 0 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  userOption: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});
