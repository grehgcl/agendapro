const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

console.log('🚀 Iniciando servidor AgendaPro...');

// Banco de dados SQLite
const db = new sqlite3.Database('master.db');

// Criar tabelas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS barbearias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cnpj TEXT,
    telefone TEXT,
    email TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    plano TEXT DEFAULT 'trial',
    data_inicio_trial DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_expiracao DATETIME,
    status TEXT DEFAULT 'ativo',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbearia_id INTEGER NOT NULL,
    valor REAL NOT NULL,
    plano TEXT NOT NULL,
    data_pagamento DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_expiracao DATETIME NOT NULL,
    status TEXT DEFAULT 'pago'
  )`);

  console.log('✅ Banco de dados SQLite inicializado');
});

// Função para criar banco de cada barbearia
function criarBancoBarbearia(barbeariaId) {
  const dbPath = `barbearia_${barbeariaId}.db`;
  const barbDb = new sqlite3.Database(dbPath);
  
  barbDb.serialize(() => {
    barbDb.run(`CREATE TABLE IF NOT EXISTS agendamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      servico TEXT NOT NULL,
      preco REAL NOT NULL,
      data TEXT NOT NULL,
      hora TEXT NOT NULL,
      telefone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    barbDb.run(`CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT,
      telefone TEXT,
      data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    barbDb.run(`CREATE TABLE IF NOT EXISTS servicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descricao TEXT,
      preco REAL NOT NULL,
      duracao INTEGER DEFAULT 30
    )`);

    barbDb.run(`CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome_empresa TEXT DEFAULT 'Meu Negócio',
      telefone TEXT DEFAULT '',
      endereco TEXT DEFAULT '',
      horario_funcionamento TEXT DEFAULT 'Seg-Sex: 09h às 20h',
      logo_texto TEXT DEFAULT '📋'
    )`);
    
    // Inserir serviços padrão
    barbDb.get("SELECT COUNT(*) as total FROM servicos", (err, row) => {
      if (row && row.total === 0) {
        const servicos = [
          ['Corte de Cabelo', 'Corte tradicional', 35.00, 30],
          ['Barba', 'Barba completa', 25.00, 30],
          ['Corte + Barba', 'Pacote completo', 55.00, 60]
        ];
        servicos.forEach(s => {
          barbDb.run('INSERT INTO servicos (nome, descricao, preco, duracao) VALUES (?, ?, ?, ?)', s);
        });
      }
    });
    
    barbDb.run(`INSERT OR IGNORE INTO config (id, nome_empresa) VALUES (1, 'Meu Negócio')`);
  });
  
  return barbDb;
}

// Rota de cadastro
app.post('/api/cadastrar-barbearia', (req, res) => {
  const { nome, email, senha, telefone, cnpj } = req.body;
  
  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios!' });
  }
  
  db.get('SELECT * FROM barbearias WHERE email = ?', [email], (err, existing) => {
    if (err) {
      return res.status(500).json({ erro: err.message });
    }
    
    if (existing) {
      return res.status(400).json({ erro: 'Email já cadastrado!' });
    }
    
    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() + 14);
    
    db.run(
      'INSERT INTO barbearias (nome, email, senha, telefone, cnpj, data_expiracao) VALUES (?, ?, ?, ?, ?, ?)',
      [nome, email, senha, telefone || '', cnpj || '', dataExpiracao.toISOString()],
      function(err) {
        if (err) {
          return res.status(500).json({ erro: err.message });
        }
        
        const barbeariaId = this.lastID;
        criarBancoBarbearia(barbeariaId);
        
        res.json({
          id: barbeariaId,
          mensagem: '✅ Cadastrado! Trial de 14 dias.',
          data_expiracao: dataExpiracao.toISOString()
        });
      }
    );
  });
});

// Login da barbearia
app.post('/api/login-barbearia', (req, res) => {
  const { email, senha } = req.body;
  
  db.get('SELECT * FROM barbearias WHERE email = ? AND senha = ?', [email, senha], (err, barbearia) => {
    if (err) {
      return res.status(500).json({ erro: err.message });
    }
    
    if (!barbearia) {
      return res.status(401).json({ erro: 'Email ou senha inválidos!' });
    }
    
    const hoje = new Date();
    const expiracao = new Date(barbearia.data_expiracao);
    
    if (barbearia.status === 'inativo') {
      return res.status(403).json({ erro: 'Conta desativada!' });
    }
    
    if (expiracao < hoje && barbearia.plano === 'trial') {
      return res.status(403).json({ erro: 'Período de teste expirou!', expirado: true });
    }
    
    const token = crypto.randomBytes(32).toString('hex');
    
    res.json({
      id: barbearia.id,
      nome: barbearia.nome,
      email: barbearia.email,
      plano: barbearia.plano,
      token: token,
      dias_restantes: Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24))
    });
  });
});

// Login admin
app.post('/api/login-admin', (req, res) => {
  const { username, senha } = req.body;
  if (username === 'superadmin' && senha === 'admin123') {
    res.json({ token: 'admin-token' });
  } else {
    res.status(401).json({ erro: 'Acesso negado!' });
  }
});

// Middleware de autenticação
function verificarAcesso(req, res, next) {
  const barbeariaId = req.headers['barbearia-id'];
  const token = req.headers['authorization'];
  
  if (!barbeariaId || !token) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  
  db.get('SELECT * FROM barbearias WHERE id = ?', [barbeariaId], (err, barbearia) => {
    if (err || !barbearia) {
      return res.status(401).json({ erro: 'Barbearia não encontrada' });
    }
    
    req.barbearia = barbearia;
    next();
  });
}

function getBarbeariaDb(barbeariaId) {
  return new sqlite3.Database(`barbearia_${barbeariaId}.db`);
}

// Dashboard
app.get('/api/dashboard', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  const hoje = new Date().toISOString().split('T')[0];
  const semana = [];
  
  for (let i = 0; i < 7; i++) {
    const data = new Date();
    data.setDate(data.getDate() + i);
    semana.push(data.toISOString().split('T')[0]);
  }
  
  dbBarb.all('SELECT * FROM agendamentos ORDER BY data, hora', (err, agendamentos) => {
    dbBarb.close();
    if (err) {
      return res.status(500).json({ erro: err.message });
    }
    
    const agendamentosPorDia = {};
    semana.forEach(dia => {
      agendamentosPorDia[dia] = agendamentos.filter(a => a.data === dia);
    });
    
    const faturamentoDia = agendamentosPorDia[hoje]?.reduce((sum, a) => sum + a.preco, 0) || 0;
    const faturamentoSemana = agendamentos.reduce((sum, a) => sum + a.preco, 0);
    
    res.json({
      semana: semana,
      agendamentos: agendamentosPorDia,
      faturamento: { dia: faturamentoDia, semana: faturamentoSemana },
      totalAgendamentos: agendamentos.length
    });
  });
});

// Listar agendamentos
app.get('/api/agendamentos', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  const { data } = req.query;
  
  let query = 'SELECT * FROM agendamentos';
  let params = [];
  
  if (data) {
    query += ' WHERE data = ? ORDER BY hora';
    params.push(data);
  } else {
    query += ' ORDER BY data, hora';
  }
  
  dbBarb.all(query, params, (err, rows) => {
    dbBarb.close();
    res.json(rows || []);
  });
});

// Criar agendamento
app.post('/api/agendamentos', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  const { nome, servico, preco, data, hora, telefone } = req.body;
  
  dbBarb.run(
    'INSERT INTO agendamentos (nome, servico, preco, data, hora, telefone) VALUES (?, ?, ?, ?, ?, ?)',
    [nome, servico, preco, data, hora, telefone || ''],
    function(err) {
      dbBarb.close();
      if (err) {
        res.status(500).json({ erro: err.message });
      } else {
        res.json({ id: this.lastID, mensagem: '✅ Agendado!' });
      }
    }
  );
});

// Deletar agendamento
app.delete('/api/agendamentos/:id', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  dbBarb.run('DELETE FROM agendamentos WHERE id = ?', [req.params.id], function(err) {
    dbBarb.close();
    if (err) {
      res.status(500).json({ erro: err.message });
    } else {
      res.json({ mensagem: '✅ Cancelado!' });
    }
  });
});

// Clientes
app.get('/api/clientes', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  dbBarb.all('SELECT * FROM clientes ORDER BY nome', (err, rows) => {
    dbBarb.close();
    res.json(rows || []);
  });
});

app.post('/api/clientes', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  const { nome, email, telefone } = req.body;
  
  dbBarb.run(
    'INSERT INTO clientes (nome, email, telefone) VALUES (?, ?, ?)',
    [nome, email, telefone || ''],
    function(err) {
      dbBarb.close();
      if (err) {
        res.status(500).json({ erro: err.message });
      } else {
        res.json({ id: this.lastID, mensagem: '✅ Cliente cadastrado!' });
      }
    }
  );
});

app.put('/api/clientes/:id', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  const { nome, email, telefone } = req.body;
  
  dbBarb.run(
    'UPDATE clientes SET nome = ?, email = ?, telefone = ? WHERE id = ?',
    [nome, email, telefone, req.params.id],
    function(err) {
      dbBarb.close();
      if (err) {
        res.status(500).json({ erro: err.message });
      } else {
        res.json({ mensagem: '✅ Atualizado!' });
      }
    }
  );
});

app.delete('/api/clientes/:id', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  dbBarb.run('DELETE FROM clientes WHERE id = ?', [req.params.id], function(err) {
    dbBarb.close();
    if (err) {
      res.status(500).json({ erro: err.message });
    } else {
      res.json({ mensagem: '✅ Excluído!' });
    }
  });
});

// Serviços
app.get('/api/servicos', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  dbBarb.all('SELECT * FROM servicos ORDER BY nome', (err, rows) => {
    dbBarb.close();
    res.json(rows || []);
  });
});

app.post('/api/servicos', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  const { nome, descricao, preco, duracao } = req.body;
  
  dbBarb.run(
    'INSERT INTO servicos (nome, descricao, preco, duracao) VALUES (?, ?, ?, ?)',
    [nome, descricao || '', preco, duracao || 30],
    function(err) {
      dbBarb.close();
      if (err) {
        res.status(500).json({ erro: err.message });
      } else {
        res.json({ id: this.lastID, mensagem: '✅ Serviço criado!' });
      }
    }
  );
});

app.put('/api/servicos/:id', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  const { nome, descricao, preco, duracao } = req.body;
  
  dbBarb.run(
    'UPDATE servicos SET nome = ?, descricao = ?, preco = ?, duracao = ? WHERE id = ?',
    [nome, descricao || '', preco, duracao || 30, req.params.id],
    function(err) {
      dbBarb.close();
      if (err) {
        res.status(500).json({ erro: err.message });
      } else {
        res.json({ mensagem: '✅ Serviço atualizado!' });
      }
    }
  );
});

app.delete('/api/servicos/:id', verificarAcesso, (req, res) => {
  const dbBarb = getBarbeariaDb(req.barbearia.id);
  dbBarb.run('DELETE FROM servicos WHERE id = ?', [req.params.id], function(err) {
    dbBarb.close();
    if (err) {
      res.status(500).json({ erro: err.message });
    } else {
      res.json({ mensagem: '✅ Serviço excluído!' });
    }
  });
});

// Planos
app.get('/api/planos', (req, res) => {
  res.json([
    { id: 'mensal', nome: 'Plano Mensal', preco: 49.90, dias: 30 },
    { id: 'trimestral', nome: 'Plano Trimestral', preco: 129.90, dias: 90 },
    { id: 'anual', nome: 'Plano Anual', preco: 499.90, dias: 365 }
  ]);
});

// Admin - Listar barbearias
app.get('/api/admin/barbearias', (req, res) => {
  const auth = req.headers['authorization'];
  if (auth !== 'admin-token') {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  
  db.all('SELECT * FROM barbearias ORDER BY id', (err, rows) => {
    if (err) {
      res.status(500).json({ erro: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Admin - Atualizar barbearia
app.put('/api/admin/barbearias/:id', (req, res) => {
  const auth = req.headers['authorization'];
  if (auth !== 'admin-token') {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  
  const { id } = req.params;
  const { nome, email, senha, plano, telefone, cnpj } = req.body;
  
  let query = 'UPDATE barbearias SET nome = ?, email = ?, telefone = ?, cnpj = ?, plano = ?';
  let params = [nome, email, telefone || '', cnpj || '', plano];
  
  if (senha && senha.trim() !== '') {
    query += ', senha = ?';
    params.push(senha);
  }
  
  query += ' WHERE id = ?';
  params.push(id);
  
  db.run(query, params, function(err) {
    if (err) {
      res.status(500).json({ erro: err.message });
    } else {
      res.json({ mensagem: '✅ Barbearia atualizada!' });
    }
  });
});

// Admin - Excluir barbearia
app.delete('/api/admin/barbearias/:id', (req, res) => {
  const auth = req.headers['authorization'];
  if (auth !== 'admin-token') {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  
  const { id } = req.params;
  
  db.get('SELECT * FROM barbearias WHERE id = ?', [id], (err, barbearia) => {
    if (err || !barbearia) {
      return res.status(404).json({ erro: 'Barbearia não encontrada' });
    }
    
    db.run('DELETE FROM barbearias WHERE id = ?', id, function(err) {
      if (err) {
        return res.status(500).json({ erro: err.message });
      }
      
      const dbPath = `barbearia_${id}.db`;
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      
      res.json({ mensagem: '✅ Barbearia excluída!' });
    });
  });
});

// Admin - Alterar status
app.put('/api/admin/barbearias/:id/status', (req, res) => {
  const auth = req.headers['authorization'];
  if (auth !== 'admin-token') {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  
  const { id } = req.params;
  const { status, dias_extras } = req.body;
  
  db.get('SELECT * FROM barbearias WHERE id = ?', [id], (err, barbearia) => {
    if (err || !barbearia) {
      return res.status(404).json({ erro: 'Barbearia não encontrada' });
    }
    
    let query = 'UPDATE barbearias SET status = ?';
    let params = [status];
    
    if (dias_extras) {
      let novaExpiracao = new Date(barbearia.data_expiracao);
      novaExpiracao.setDate(novaExpiracao.getDate() + dias_extras);
      query += ', data_expiracao = ?';
      params.push(novaExpiracao.toISOString());
    }
    
    query += ' WHERE id = ?';
    params.push(id);
    
    db.run(query, params, function(err) {
      if (err) {
        res.status(500).json({ erro: err.message });
      } else {
        res.json({ mensagem: 'Status atualizado!' });
      }
    });
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║     🚀 AGENDAPRO - Sistema de Gestão             ║
╠══════════════════════════════════════════════════╣
║  Modo: 📁 SQLite (Local)                         ║
║  Porta: ${PORT}                                           ║
║  URL: http://localhost:${PORT}                           ║
║  Admin: http://localhost:${PORT}/admin-panel.html       ║
║  Login Admin: superadmin / admin123               ║
╚══════════════════════════════════════════════════╝
  `);
});