const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============= DETECTAR AMBIENTE =============
const USE_POSTGRES = process.env.DATABASE_URL ? true : false;

console.log(`🚀 Iniciando servidor em modo: ${USE_POSTGRES ? 'PRODUÇÃO (PostgreSQL)' : 'DESENVOLVIMENTO (SQLite)'}`);

let db;
let getBarbeariaDb;
let criarBancoBarbeariaSqlite; // Declarar aqui para escopo global

if (USE_POSTGRES) {
    // ============= POSTGRESQL (RENDER) =============
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    db = pool;

    getBarbeariaDb = (barbeariaId) => {
        return {
            query: async (sql, params) => await pool.query(sql, params)
        };
    };

    // Criar tabelas no PostgreSQL
    async function initPostgres() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS barbearias (
                    id SERIAL PRIMARY KEY,
                    nome TEXT NOT NULL,
                    cnpj TEXT,
                    telefone TEXT,
                    email TEXT UNIQUE NOT NULL,
                    senha TEXT NOT NULL,
                    plano TEXT DEFAULT 'trial',
                    data_expiracao TIMESTAMP,
                    status TEXT DEFAULT 'ativo',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS agendamentos (
                    id SERIAL PRIMARY KEY,
                    barbearia_id INTEGER NOT NULL,
                    nome TEXT NOT NULL,
                    servico TEXT NOT NULL,
                    preco REAL NOT NULL,
                    data DATE NOT NULL,
                    hora TEXT NOT NULL,
                    telefone TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS clientes (
                    id SERIAL PRIMARY KEY,
                    barbearia_id INTEGER NOT NULL,
                    nome TEXT NOT NULL,
                    email TEXT,
                    telefone TEXT,
                    data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS servicos (
                    id SERIAL PRIMARY KEY,
                    barbearia_id INTEGER NOT NULL,
                    nome TEXT NOT NULL,
                    descricao TEXT,
                    preco REAL NOT NULL,
                    duracao INTEGER DEFAULT 30
                )
            `);

            console.log('✅ Tabelas PostgreSQL criadas/verificadas');
        } catch (error) {
            console.error('Erro PostgreSQL:', error.message);
        }
    }

    initPostgres();

} else {
    // ============= SQLITE (LOCAL) =============
    const sqlite3 = require('sqlite3').verbose();
    const sqliteDb = new sqlite3.Database('master.db');
    db = sqliteDb;

    // Criar banco para cada barbearia no SQLite
    criarBancoBarbeariaSqlite = (barbeariaId) => {
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
        });
        return barbDb;
    };

    getBarbeariaDb = (barbeariaId) => {
        return new sqlite3.Database(`barbearia_${barbeariaId}.db`);
    };

    // Criar tabelas no SQLite
    sqliteDb.serialize(() => {
        sqliteDb.run(`CREATE TABLE IF NOT EXISTS barbearias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            cnpj TEXT,
            telefone TEXT,
            email TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL,
            plano TEXT DEFAULT 'trial',
            data_expiracao DATETIME,
            status TEXT DEFAULT 'ativo',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✅ Tabelas SQLite criadas/verificadas');
    });
}

// ============= FUNÇÕES AUXILIARES =============

async function executarQuery(dbInstance, sql, params = []) {
    if (USE_POSTGRES) {
        const result = await dbInstance.query(sql, params);
        return { rows: result.rows };
    } else {
        return new Promise((resolve, reject) => {
            dbInstance.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve({ rows });
            });
        });
    }
}

async function executarRun(dbInstance, sql, params = []) {
    if (USE_POSTGRES) {
        const result = await dbInstance.query(sql, params);
        return { lastID: result.rows[0]?.id };
    } else {
        return new Promise((resolve, reject) => {
            dbInstance.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID });
            });
        });
    }
}

// ============= MIDDLEWARE =============

async function verificarAcesso(req, res, next) {
    const barbeariaId = req.headers['barbearia-id'];
    if (!barbeariaId) {
        return res.status(401).json({ erro: 'Não autorizado' });
    }
    req.barbeariaId = parseInt(barbeariaId);
    next();
}

// ============= ROTAS =============

// Cadastro
app.post('/api/cadastrar-barbearia', async (req, res) => {
    const { nome, email, senha, telefone, cnpj } = req.body;

    console.log('📝 Recebendo cadastro:', { nome, email, telefone, cnpj });

    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios!' });
    }

    try {
        // Verificar se email já existe
        let existe = false;
        if (USE_POSTGRES) {
            const result = await db.query('SELECT id FROM barbearias WHERE email = $1', [email]);
            existe = result.rows.length > 0;
        } else {
            const result = await executarQuery(db, 'SELECT id FROM barbearias WHERE email = ?', [email]);
            existe = result.rows.length > 0;
        }

        if (existe) {
            return res.status(400).json({ erro: 'Este email já está cadastrado!' });
        }

        const dataExpiracao = new Date();
        dataExpiracao.setDate(dataExpiracao.getDate() + 14);

        let barbeariaId;

        if (USE_POSTGRES) {
            const result = await db.query(
                `INSERT INTO barbearias (nome, email, senha, telefone, cnpj, data_expiracao) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [nome, email, senha, telefone || '', cnpj || '', dataExpiracao]
            );
            barbeariaId = result.rows[0].id;
        } else {
            const result = await executarRun(db,
                `INSERT INTO barbearias (nome, email, senha, telefone, cnpj, data_expiracao) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [nome, email, senha, telefone || '', cnpj || '', dataExpiracao.toISOString()]
            );
            barbeariaId = result.lastID;

            // Criar banco da barbearia no SQLite
            if (criarBancoBarbeariaSqlite) {
                criarBancoBarbeariaSqlite(barbeariaId);
            }
        }

        console.log('✅ Cadastro realizado! ID:', barbeariaId);

        res.json({
            id: barbeariaId,
            mensagem: '✅ Cadastrado com sucesso! Trial de 14 dias.',
            data_expiracao: dataExpiracao.toISOString()
        });
    } catch (error) {
        console.error('❌ Erro no cadastro:', error.message);
        res.status(500).json({ erro: 'Erro ao cadastrar: ' + error.message });
    }
});

// Login
app.post('/api/login-barbearia', async (req, res) => {
    const { email, senha } = req.body;

    try {
        const result = await executarQuery(db, 'SELECT * FROM barbearias WHERE email = ? AND senha = ?', [email, senha]);

        if (result.rows.length === 0) {
            return res.status(401).json({ erro: 'Email ou senha inválidos!' });
        }

        const barbearia = result.rows[0];
        const token = crypto.randomBytes(32).toString('hex');

        res.json({
            id: barbearia.id,
            nome: barbearia.nome,
            email: barbearia.email,
            plano: barbearia.plano,
            token: token,
            dias_restantes: 14
        });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Login Admin
app.post('/api/login-admin', (req, res) => {
    const { username, senha } = req.body;
    if (username === 'superadmin' && senha === 'admin123') {
        res.json({ token: 'admin-token' });
    } else {
        res.status(401).json({ erro: 'Acesso negado!' });
    }
});

// Dashboard
app.get('/api/dashboard', verificarAcesso, async (req, res) => {
    try {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = hoje.getMonth();
        const dia = hoje.getDate();

        const semana = [];
        for (let i = 0; i < 7; i++) {
            const data = new Date(ano, mes, dia + i);
            const dataStr = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
            semana.push(dataStr);
        }

        let agendamentos = [];
        if (USE_POSTGRES) {
            const result = await db.query(
                'SELECT * FROM agendamentos WHERE barbearia_id = $1 ORDER BY data, hora',
                [req.barbeariaId]
            );
            agendamentos = result.rows;
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            agendamentos = await new Promise((resolve, reject) => {
                barbDb.all('SELECT * FROM agendamentos ORDER BY data, hora', (err, rows) => {
                    barbDb.close();
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }

        const agendamentosPorDia = {};
        semana.forEach(dia => {
            agendamentosPorDia[dia] = agendamentos.filter(a => a.data === dia);
        });

        const faturamentoHoje = agendamentosPorDia[semana[0]]?.reduce((sum, a) => sum + a.preco, 0) || 0;
        const faturamentoSemana = agendamentos.reduce((sum, a) => sum + a.preco, 0);

        res.json({
            semana: semana,
            agendamentos: agendamentosPorDia,
            faturamento: { dia: faturamentoHoje, semana: faturamentoSemana },
            totalAgendamentos: agendamentos.length
        });
    } catch (error) {
        console.error('Erro no dashboard:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Agendamentos
app.get('/api/agendamentos', verificarAcesso, async (req, res) => {
    const { data } = req.query;
    try {
        let agendamentos = [];
        if (USE_POSTGRES) {
            let query = 'SELECT * FROM agendamentos WHERE barbearia_id = $1';
            let params = [req.barbeariaId];
            if (data) {
                query += ' AND data = $2 ORDER BY hora';
                params.push(data);
            } else {
                query += ' ORDER BY data, hora';
            }
            const result = await db.query(query, params);
            agendamentos = result.rows;
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            agendamentos = await new Promise((resolve, reject) => {
                let query = 'SELECT * FROM agendamentos';
                let params = [];
                if (data) {
                    query += ' WHERE data = ? ORDER BY hora';
                    params.push(data);
                } else {
                    query += ' ORDER BY data, hora';
                }
                barbDb.all(query, params, (err, rows) => {
                    barbDb.close();
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }
        res.json(agendamentos);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/agendamentos', verificarAcesso, async (req, res) => {
    const { nome, servico, preco, data, hora, telefone } = req.body;
    try {
        if (USE_POSTGRES) {
            await db.query(
                `INSERT INTO agendamentos (barbearia_id, nome, servico, preco, data, hora, telefone)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [req.barbeariaId, nome, servico, preco, data, hora, telefone || '']
            );
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            await new Promise((resolve, reject) => {
                barbDb.run(
                    `INSERT INTO agendamentos (nome, servico, preco, data, hora, telefone)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [nome, servico, preco, data, hora, telefone || ''],
                    (err) => {
                        barbDb.close();
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        res.json({ mensagem: '✅ Agendado com sucesso!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.delete('/api/agendamentos/:id', verificarAcesso, async (req, res) => {
    try {
        if (USE_POSTGRES) {
            await db.query('DELETE FROM agendamentos WHERE id = $1 AND barbearia_id = $2', [req.params.id, req.barbeariaId]);
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            await new Promise((resolve, reject) => {
                barbDb.run('DELETE FROM agendamentos WHERE id = ?', [req.params.id], (err) => {
                    barbDb.close();
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        res.json({ mensagem: '✅ Cancelado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Clientes
app.get('/api/clientes', verificarAcesso, async (req, res) => {
    try {
        let clientes = [];
        if (USE_POSTGRES) {
            const result = await db.query('SELECT * FROM clientes WHERE barbearia_id = $1 ORDER BY nome', [req.barbeariaId]);
            clientes = result.rows;
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            clientes = await new Promise((resolve, reject) => {
                barbDb.all('SELECT * FROM clientes ORDER BY nome', (err, rows) => {
                    barbDb.close();
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }
        res.json(clientes);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/clientes', verificarAcesso, async (req, res) => {
    const { nome, email, telefone } = req.body;
    try {
        if (USE_POSTGRES) {
            await db.query(
                `INSERT INTO clientes (barbearia_id, nome, email, telefone) VALUES ($1, $2, $3, $4)`,
                [req.barbeariaId, nome, email, telefone || '']
            );
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            await new Promise((resolve, reject) => {
                barbDb.run(
                    `INSERT INTO clientes (nome, email, telefone) VALUES (?, ?, ?)`,
                    [nome, email, telefone || ''],
                    (err) => {
                        barbDb.close();
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        res.json({ mensagem: '✅ Cliente cadastrado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.put('/api/clientes/:id', verificarAcesso, async (req, res) => {
    const { nome, email, telefone } = req.body;
    try {
        if (USE_POSTGRES) {
            await db.query(
                `UPDATE clientes SET nome = $1, email = $2, telefone = $3 WHERE id = $4 AND barbearia_id = $5`,
                [nome, email, telefone, req.params.id, req.barbeariaId]
            );
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            await new Promise((resolve, reject) => {
                barbDb.run(
                    `UPDATE clientes SET nome = ?, email = ?, telefone = ? WHERE id = ?`,
                    [nome, email, telefone, req.params.id],
                    (err) => {
                        barbDb.close();
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        res.json({ mensagem: '✅ Atualizado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.delete('/api/clientes/:id', verificarAcesso, async (req, res) => {
    try {
        if (USE_POSTGRES) {
            await db.query('DELETE FROM clientes WHERE id = $1 AND barbearia_id = $2', [req.params.id, req.barbeariaId]);
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            await new Promise((resolve, reject) => {
                barbDb.run('DELETE FROM clientes WHERE id = ?', [req.params.id], (err) => {
                    barbDb.close();
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        res.json({ mensagem: '✅ Excluído!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Serviços
app.get('/api/servicos', verificarAcesso, async (req, res) => {
    try {
        let servicos = [];
        if (USE_POSTGRES) {
            const result = await db.query('SELECT * FROM servicos WHERE barbearia_id = $1 ORDER BY nome', [req.barbeariaId]);
            servicos = result.rows;
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            servicos = await new Promise((resolve, reject) => {
                barbDb.all('SELECT * FROM servicos ORDER BY nome', (err, rows) => {
                    barbDb.close();
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }
        res.json(servicos);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/servicos', verificarAcesso, async (req, res) => {
    const { nome, descricao, preco, duracao } = req.body;
    try {
        if (USE_POSTGRES) {
            await db.query(
                `INSERT INTO servicos (barbearia_id, nome, descricao, preco, duracao) VALUES ($1, $2, $3, $4, $5)`,
                [req.barbeariaId, nome, descricao || '', preco, duracao || 30]
            );
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            await new Promise((resolve, reject) => {
                barbDb.run(
                    `INSERT INTO servicos (nome, descricao, preco, duracao) VALUES (?, ?, ?, ?)`,
                    [nome, descricao || '', preco, duracao || 30],
                    (err) => {
                        barbDb.close();
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        res.json({ mensagem: '✅ Serviço criado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.put('/api/servicos/:id', verificarAcesso, async (req, res) => {
    const { nome, descricao, preco, duracao } = req.body;
    try {
        if (USE_POSTGRES) {
            await db.query(
                `UPDATE servicos SET nome = $1, descricao = $2, preco = $3, duracao = $4 WHERE id = $5 AND barbearia_id = $6`,
                [nome, descricao || '', preco, duracao || 30, req.params.id, req.barbeariaId]
            );
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            await new Promise((resolve, reject) => {
                barbDb.run(
                    `UPDATE servicos SET nome = ?, descricao = ?, preco = ?, duracao = ? WHERE id = ?`,
                    [nome, descricao || '', preco, duracao || 30, req.params.id],
                    (err) => {
                        barbDb.close();
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        res.json({ mensagem: '✅ Serviço atualizado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.delete('/api/servicos/:id', verificarAcesso, async (req, res) => {
    try {
        if (USE_POSTGRES) {
            await db.query('DELETE FROM servicos WHERE id = $1 AND barbearia_id = $2', [req.params.id, req.barbeariaId]);
        } else {
            const barbDb = getBarbeariaDb(req.barbeariaId);
            await new Promise((resolve, reject) => {
                barbDb.run('DELETE FROM servicos WHERE id = ?', [req.params.id], (err) => {
                    barbDb.close();
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        res.json({ mensagem: '✅ Serviço excluído!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Planos
app.get('/api/planos', (req, res) => {
    res.json([
        { id: 'mensal', nome: 'Plano Mensal', preco: 49.90 },
        { id: 'trimestral', nome: 'Plano Trimestral', preco: 129.90 },
        { id: 'anual', nome: 'Plano Anual', preco: 499.90 }
    ]);
});

// Admin - Listar barbearias
app.get('/api/admin/barbearias', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== 'admin-token') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    try {
        const result = await executarQuery(db, 'SELECT id, nome, email, telefone, plano, status, data_expiracao FROM barbearias ORDER BY id');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Admin - Atualizar barbearia
app.put('/api/admin/barbearias/:id', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== 'admin-token') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    const { id } = req.params;
    const { nome, email, senha, plano, telefone, cnpj } = req.body;

    try {
        if (USE_POSTGRES) {
            if (senha && senha.trim() !== '') {
                await db.query(
                    `UPDATE barbearias SET nome = $1, email = $2, telefone = $3, cnpj = $4, plano = $5, senha = $6 WHERE id = $7`,
                    [nome, email, telefone || '', cnpj || '', plano, senha, id]
                );
            } else {
                await db.query(
                    `UPDATE barbearias SET nome = $1, email = $2, telefone = $3, cnpj = $4, plano = $5 WHERE id = $6`,
                    [nome, email, telefone || '', cnpj || '', plano, id]
                );
            }
        } else {
            if (senha && senha.trim() !== '') {
                await executarRun(db,
                    `UPDATE barbearias SET nome = ?, email = ?, telefone = ?, cnpj = ?, plano = ?, senha = ? WHERE id = ?`,
                    [nome, email, telefone || '', cnpj || '', plano, senha, id]
                );
            } else {
                await executarRun(db,
                    `UPDATE barbearias SET nome = ?, email = ?, telefone = ?, cnpj = ?, plano = ? WHERE id = ?`,
                    [nome, email, telefone || '', cnpj || '', plano, id]
                );
            }
        }

        res.json({ mensagem: '✅ Barbearia atualizada!' });
    } catch (error) {
        console.error('Erro ao atualizar:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Admin - Excluir barbearia
app.delete('/api/admin/barbearias/:id', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== 'admin-token') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    const { id } = req.params;

    try {
        let nome = '';
        if (USE_POSTGRES) {
            const result = await db.query('SELECT nome FROM barbearias WHERE id = $1', [id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ erro: 'Barbearia não encontrada' });
            }
            nome = result.rows[0].nome;
            await db.query('DELETE FROM barbearias WHERE id = $1', [id]);
        } else {
            const result = await executarQuery(db, 'SELECT nome FROM barbearias WHERE id = ?', [id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ erro: 'Barbearia não encontrada' });
            }
            nome = result.rows[0].nome;
            await executarRun(db, 'DELETE FROM barbearias WHERE id = ?', [id]);

            const dbPath = `barbearia_${id}.db`;
            if (fs.existsSync(dbPath)) {
                fs.unlinkSync(dbPath);
            }
        }

        res.json({ mensagem: `✅ Barbearia "${nome}" excluída!` });
    } catch (error) {
        console.error('Erro ao excluir:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Admin - Alterar status
app.put('/api/admin/barbearias/:id/status', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== 'admin-token') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    const { id } = req.params;
    const { status, dias_extras } = req.body;

    try {
        if (USE_POSTGRES) {
            if (dias_extras) {
                const result = await db.query('SELECT data_expiracao FROM barbearias WHERE id = $1', [id]);
                if (result.rows.length === 0) {
                    return res.status(404).json({ erro: 'Barbearia não encontrada' });
                }
                let novaExpiracao = new Date(result.rows[0].data_expiracao);
                novaExpiracao.setDate(novaExpiracao.getDate() + dias_extras);
                await db.query(
                    'UPDATE barbearias SET status = $1, data_expiracao = $2 WHERE id = $3',
                    [status, novaExpiracao, id]
                );
            } else {
                await db.query(
                    'UPDATE barbearias SET status = $1 WHERE id = $2',
                    [status, id]
                );
            }
        } else {
            if (dias_extras) {
                const result = await executarQuery(db, 'SELECT data_expiracao FROM barbearias WHERE id = ?', [id]);
                if (result.rows.length === 0) {
                    return res.status(404).json({ erro: 'Barbearia não encontrada' });
                }
                let novaExpiracao = new Date(result.rows[0].data_expiracao);
                novaExpiracao.setDate(novaExpiracao.getDate() + dias_extras);
                await executarRun(db,
                    'UPDATE barbearias SET status = ?, data_expiracao = ? WHERE id = ?',
                    [status, novaExpiracao.toISOString(), id]
                );
            } else {
                await executarRun(db,
                    'UPDATE barbearias SET status = ? WHERE id = ?',
                    [status, id]
                );
            }
        }

        res.json({ mensagem: '✅ Status atualizado!' });
    } catch (error) {
        console.error('Erro ao alterar status:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📁 Modo: ${USE_POSTGRES ? 'POSTGRESQL (Produção)' : 'SQLITE (Desenvolvimento)'}`);
});