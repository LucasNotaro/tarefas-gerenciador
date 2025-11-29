import { StatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.50.64:3000';

let db = null;

const getDatabase = async () => {
  if (!db) {
    try {
      db = await SQLite.openDatabaseAsync('tarefas.db');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          titulo TEXT NOT NULL,
          descricao TEXT,
          status TEXT DEFAULT 'aberta',
          criador_nome TEXT NOT NULL,
          criador_email TEXT,
          criado_em TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      console.error('Erro ao abrir banco de dados:', error);
      throw error;
    }
  }
  return db;
};

const mapSqliteRow = (row) => ({
  id: row.id,
  titulo: row.titulo,
  descricao: row.descricao ?? '',
  status: row.status ?? 'aberta',
  criadorNome: row.criador_nome ?? '',
  criadorEmail: row.criador_email ?? '',
  criadoEm: row.criado_em ?? '',
});

const listarSQLite = async () => {
  try {
    const database = await getDatabase();
    const result = await database.getAllAsync(
      'SELECT * FROM tasks ORDER BY datetime(coalesce(criado_em, current_timestamp)) DESC, id DESC'
    );
    return result.map(mapSqliteRow);
  } catch (error) {
    console.error('Erro ao listar tarefas:', error);
    throw error;
  }
};

const obterSQLite = async (id) => {
  try {
    const database = await getDatabase();
    const result = await database.getFirstAsync('SELECT * FROM tasks WHERE id = ?', [id]);
    return result ? mapSqliteRow(result) : null;
  } catch (error) {
    console.error('Erro ao obter tarefa:', error);
    throw error;
  }
};

const inserirSQLite = async ({ titulo, descricao, status, criadorNome, criadorEmail }) => {
  try {
    const database = await getDatabase();
    const result = await database.runAsync(
      `INSERT INTO tasks (titulo, descricao, status, criador_nome, criador_email, criado_em)
       VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`,
      [titulo, descricao, status, criadorNome, criadorEmail]
    );
    return obterSQLite(result.lastInsertRowId);
  } catch (error) {
    console.error('Erro ao inserir tarefa:', error);
    throw error;
  }
};

const atualizarSQLite = async (id, { titulo, descricao, status, criadorNome, criadorEmail }) => {
  try {
    const database = await getDatabase();
    await database.runAsync(
      `UPDATE tasks
       SET titulo = ?, descricao = ?, status = ?, criador_nome = ?, criador_email = ?
       WHERE id = ?`,
      [titulo, descricao, status, criadorNome, criadorEmail, id]
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

const fetchJson = async (url, options = {}) => {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const message = await resp.text();
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
        <TouchableOpacity style={styles.switchBtn} onPress={onTrocarBanco}>
          <Text style={styles.switchBtnText}>Trocar banco</Text>
        </TouchableOpacity>
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
            <Text style={styles.cardSub}>Criado por: {item.criadorNome}</Text>
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

function Form({ form, setForm, onSalvar, onCancelar, styles }) {
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
        <TextInput
          placeholder="Status (ex.: aberta)"
          style={styles.input}
          value={form.status}
          onChangeText={(v) => setForm((prev) => ({ ...prev, status: v }))}
        />
        <TextInput
          placeholder="Nome de quem criou"
          style={styles.input}
          value={form.criadorNome}
          onChangeText={(v) => setForm((prev) => ({ ...prev, criadorNome: v }))}
        />
        <TextInput
          placeholder="E-mail (opcional)"
          style={styles.input}
          value={form.criadorEmail}
          onChangeText={(v) => setForm((prev) => ({ ...prev, criadorEmail: v }))}
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Button title="Salvar" onPress={onSalvar} />
          <Button title="Cancelar" color="#888" onPress={onCancelar} />
        </View>
      </View>
    </View>
  );
}

function Detalhe({ tarefa, onVoltar, styles }) {
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
          <Text style={styles.bold}>Criado por:</Text> {tarefa.criadorNome}
        </Text>
        <Text style={styles.detail}>
          <Text style={styles.bold}>E-mail:</Text> {tarefa.criadorEmail || '-'}
        </Text>
        <Text style={styles.detail}>
          <Text style={styles.bold}>Criado em:</Text> {tarefa.criadoEm || '-'}
        </Text>
        <Button title="Voltar" onPress={onVoltar} />
      </View>
    </View>
  );
}

/* ===================== APP ===================== */

export default function App() {
  const [tela, setTela] = useState('lista');
  const [tarefas, setTarefas] = useState([]);
  const [fonteDados, setFonteDados] = useState(null); // 'sqlite' | 'postgres'
  const [carregando, setCarregando] = useState(false);
  const [selecionada, setSelecionada] = useState(null);
  const [mostrandoSplash, setMostrandoSplash] = useState(true);
  const [form, setForm] = useState({
    id: null,
    titulo: '',
    descricao: '',
    status: 'aberta',
    criadorNome: '',
    criadorEmail: '',
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
    carregarTarefas();
  }, [fonteDados]);

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
      status: 'aberta',
      criadorNome: '',
      criadorEmail: '',
    });
  };

  const abrirFormCriar = () => {
    limparForm();
    setSelecionada(null);
    setTela('form');
  };

  const abrirFormEditar = (tarefa) => {
    setForm({
      id: tarefa.id,
      titulo: tarefa.titulo,
      descricao: tarefa.descricao ?? '',
      status: tarefa.status ?? 'aberta',
      criadorNome: tarefa.criadorNome ?? '',
      criadorEmail: tarefa.criadorEmail ?? '',
    });
    setTela('form');
  };

  const abrirDetalhe = (tarefa) => {
    setSelecionada(tarefa);
    setTela('detalhe');
  };

  const salvar = async () => {
    if (!fonteDados) return;
    if (!form.titulo.trim() || !form.criadorNome.trim()) {
      return Alert.alert('Atenção', 'Informe o título e quem criou a tarefa.');
    }

    const payload = {
      titulo: form.titulo.trim(),
      descricao: form.descricao.trim(),
      status: form.status.trim() || 'aberta',
      criadorNome: form.criadorNome.trim(),
      criadorEmail: form.criadorEmail.trim(),
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

  const fonteLabel =
    fonteDados === 'sqlite' ? 'SQLite (local)' : 'Postgres (Neon)';

  const voltarSelecaoBanco = () => {
    setFonteDados(null);
    setTarefas([]);
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
    <View style={{ flex: 1 }}>
      {tela === 'lista' && (
        <Lista
          tarefas={tarefas}
          carregando={carregando}
          fonteLabel={fonteLabel}
          onTrocarBanco={voltarSelecaoBanco}
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
          onSalvar={salvar}
          onCancelar={() => setTela('lista')}
          styles={styles}
        />
      )}

      {tela === 'detalhe' && (
        <Detalhe
          tarefa={selecionada}
          onVoltar={() => setTela('lista')}
          styles={styles}
        />
      )}
    </View>
  );
}

/* ===================== STYLES ===================== */

const styles = StyleSheet.create({
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
});
