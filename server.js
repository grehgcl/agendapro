const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Conexão PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ============= FUNÇÕES =============

async function initDatabase() {
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

        console.log('✅ Banco de dados PostgreSQL pronto!');
    } catch (error) {
        console.error('❌ Erro:', error.message);
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

    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios!' });
    }

    try {
        const existe = await pool.query('SELECT id FROM barbearias WHERE email = $1', [email]);
        if (existe.rows.length > 0) {
            return res.status(400).json({ erro: 'Email já cadastrado!' });
        }

        const dataExpiracao = new Date();
        dataExpiracao.setDate(dataExpiracao.getDate() + 14);

        const result = await pool.query(
            `INSERT INTO barbearias (nome, email, senha, telefone, cnpj, data_expiracao) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [nome, email, senha, telefone || '', cnpj || '', dataExpiracao]
        );

        res.json({
            id: result.rows[0].id,
            mensagem: '✅ Cadastrado com sucesso! Trial de 14 dias.'
        });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Login Barbearia
app.post('/api/login-barbearia', async (req, res) => {
    const { email, senha } = req.body;

    try {
        const result = await pool.query(
            'SELECT * FROM barbearias WHERE email = $1 AND senha = $2',
            [email, senha]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ erro: 'Email ou senha inválidos!' });
        }

        const barbearia = result.rows[0];
        const token = crypto.randomBytes(32).toString('hex');

        res.json({
            id: barbearia.id,
            nome: barbearia.nome,
            email: barbearia.email,
            token: token
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
        // Buscar agendamentos da barbearia
        const result = await pool.query(
            'SELECT * FROM agendamentos WHERE barbearia_id = $1 ORDER BY data, hora',
            [req.barbeariaId]
        );

        console.log(`📊 Dashboard - Barbearia ${req.barbeariaId} tem ${result.rows.length} agendamentos`);

        // Gerar próximos 7 dias
        const semana = [];
        const hoje = new Date();
        for (let i = 0; i < 7; i++) {
            const data = new Date();
            data.setDate(hoje.getDate() + i);
            const dataStr = data.toISOString().split('T')[0];
            semana.push(dataStr);
        }

        // Organizar por dia
        const agendamentosPorDia = {};
        semana.forEach(dia => {
            agendamentosPorDia[dia] = result.rows.filter(a => a.data === dia);
        });

        // Calcular faturamentos
        const hojeStr = hoje.toISOString().split('T')[0];
        const faturamentoHoje = agendamentosPorDia[hojeStr]?.reduce((sum, a) => sum + a.preco, 0) || 0;
        const faturamentoSemana = result.rows.reduce((sum, a) => sum + a.preco, 0);

        res.json({
            semana: semana,
            agendamentos: agendamentosPorDia,
            faturamento: { dia: faturamentoHoje, semana: faturamentoSemana, mes: 0 },
            totalAgendamentos: result.rows.length
        });
    } catch (error) {
        console.error('Erro no dashboard:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Listar agendamentos
app.get('/api/agendamentos', verificarAcesso, async (req, res) => {
    const { data } = req.query;

    try {
        let query = 'SELECT * FROM agendamentos WHERE barbearia_id = $1';
        let params = [req.barbeariaId];

        if (data) {
            query += ' AND data = $2 ORDER BY hora';
            params.push(data);
        } else {
            query += ' ORDER BY data, hora';
        }

        const result = await pool.query(query, params);
        console.log(`📋 Listando ${result.rows.length} agendamentos para barbearia ${req.barbeariaId}`);
        res.json(result.rows);
    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Criar agendamento
app.post('/api/agendamentos', verificarAcesso, async (req, res) => {
    const { nome, servico, preco, data, hora, telefone } = req.body;

    console.log('📝 Criando agendamento:', { nome, servico, preco, data, hora, barbeariaId: req.barbeariaId });

    try {
        const result = await pool.query(
            `INSERT INTO agendamentos (barbearia_id, nome, servico, preco, data, hora, telefone)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [req.barbeariaId, nome, servico, preco, data, hora, telefone || '']
        );

        console.log('✅ Agendamento criado! ID:', result.rows[0].id);
        res.json({ mensagem: '✅ Agendado com sucesso!', id: result.rows[0].id });
    } catch (error) {
        console.error('❌ Erro ao criar:', error.message);
        res.status(500).json({ erro: error.message });
    }
});

// Deletar agendamento
app.delete('/api/agendamentos/:id', verificarAcesso, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM agendamentos WHERE id = $1 AND barbearia_id = $2',
            [req.params.id, req.barbeariaId]
        );
        res.json({ mensagem: '✅ Cancelado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Clientes
app.get('/api/clientes', verificarAcesso, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM clientes WHERE barbearia_id = $1 ORDER BY nome',
            [req.barbeariaId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/clientes', verificarAcesso, async (req, res) => {
    const { nome, email, telefone } = req.body;

    try {
        await pool.query(
            `INSERT INTO clientes (barbearia_id, nome, email, telefone) 
             VALUES ($1, $2, $3, $4)`,
            [req.barbeariaId, nome, email, telefone || '']
        );
        res.json({ mensagem: '✅ Cliente cadastrado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.put('/api/clientes/:id', verificarAcesso, async (req, res) => {
    const { nome, email, telefone } = req.body;

    try {
        await pool.query(
            `UPDATE clientes SET nome = $1, email = $2, telefone = $3 
             WHERE id = $4 AND barbearia_id = $5`,
            [nome, email, telefone, req.params.id, req.barbeariaId]
        );
        res.json({ mensagem: '✅ Atualizado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.delete('/api/clientes/:id', verificarAcesso, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM clientes WHERE id = $1 AND barbearia_id = $2',
            [req.params.id, req.barbeariaId]
        );
        res.json({ mensagem: '✅ Excluído!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Serviços
app.get('/api/servicos', verificarAcesso, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM servicos WHERE barbearia_id = $1 ORDER BY nome',
            [req.barbeariaId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/servicos', verificarAcesso, async (req, res) => {
    const { nome, descricao, preco, duracao } = req.body;

    try {
        await pool.query(
            `INSERT INTO servicos (barbearia_id, nome, descricao, preco, duracao) 
             VALUES ($1, $2, $3, $4, $5)`,
            [req.barbeariaId, nome, descricao || '', preco, duracao || 30]
        );
        res.json({ mensagem: '✅ Serviço criado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.put('/api/servicos/:id', verificarAcesso, async (req, res) => {
    const { nome, descricao, preco, duracao } = req.body;

    try {
        await pool.query(
            `UPDATE servicos SET nome = $1, descricao = $2, preco = $3, duracao = $4 
             WHERE id = $5 AND barbearia_id = $6`,
            [nome, descricao || '', preco, duracao || 30, req.params.id, req.barbeariaId]
        );
        res.json({ mensagem: '✅ Serviço atualizado!' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.delete('/api/servicos/:id', verificarAcesso, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM servicos WHERE id = $1 AND barbearia_id = $2',
            [req.params.id, req.barbeariaId]
        );
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

// Admin
app.get('/api/admin/barbearias', async (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== 'admin-token') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    try {
        const result = await pool.query('SELECT id, nome, email, status FROM barbearias ORDER BY id');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Iniciar servidor
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`📁 Modo: PostgreSQL (Render)`);
    });
});