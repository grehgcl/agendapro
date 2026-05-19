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

        console.log('✅ Banco de dados pronto!');
    } catch (error) {
        console.error('Erro:', error.message);
    }
}

// Middleware de autenticação
async function verificarAcesso(req, res, next) {
    const barbeariaId = req.headers['barbearia-id'];
    const token = req.headers['authorization'];

    console.log('🔐 Verificando acesso:', { barbeariaId, token });

    if (!barbeariaId || !token) {
        console.log('❌ Falta ID ou token');
        return res.status(401).json({ erro: 'Não autorizado - falta credenciais' });
    }

    try {
        // Verificar se a barbearia existe
        const result = await pool.query('SELECT * FROM barbearias WHERE id = $1', [barbeariaId]);

        if (result.rows.length === 0) {
            console.log('❌ Barbearia não encontrada:', barbeariaId);
            return res.status(401).json({ erro: 'Não autorizado - barbearia não encontrada' });
        }

        const barbearia = result.rows[0];

        // Verificar se o token é válido (opcional: validar token)
        // Por enquanto, aceita qualquer token

        console.log('✅ Acesso permitido para barbearia:', barbearia.id, barbearia.nome);
        req.barbeariaId = parseInt(barbeariaId);
        next();
    } catch (error) {
        console.error('❌ Erro na autenticação:', error);
        res.status(500).json({ erro: 'Erro interno' });
    }
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

        // Inserir serviços padrão se não existirem
        const servicos = await pool.query('SELECT * FROM servicos WHERE barbearia_id = $1', [barbearia.id]);
        if (servicos.rows.length === 0) {
            await pool.query(
                `INSERT INTO servicos (barbearia_id, nome, preco, duracao) VALUES 
                ($1, 'Corte de Cabelo', 35, 30),
                ($1, 'Barba', 25, 30),
                ($1, 'Corte + Barba', 55, 60)`,
                [barbearia.id]
            );
        }

        res.json({
            id: barbearia.id,
            nome: barbearia.nome,
            email: barbearia.email,
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
        const result = await pool.query(
            'SELECT * FROM agendamentos WHERE barbearia_id = $1 ORDER BY data, hora',
            [req.barbeariaId]
        );

        const hoje = new Date();
        const semana = [];
        for (let i = 0; i < 7; i++) {
            const data = new Date();
            data.setDate(hoje.getDate() + i);
            semana.push(data.toISOString().split('T')[0]);
        }

        const agendamentosPorDia = {};
        semana.forEach(dia => {
            agendamentosPorDia[dia] = result.rows.filter(a => a.data === dia);
        });

        const hojeStr = hoje.toISOString().split('T')[0];
        const faturamentoHoje = agendamentosPorDia[hojeStr]?.reduce((sum, a) => sum + a.preco, 0) || 0;
        const faturamentoSemana = result.rows.reduce((sum, a) => sum + a.preco, 0);

        res.json({
            semana: semana,
            agendamentos: agendamentosPorDia,
            faturamento: { dia: faturamentoHoje, semana: faturamentoSemana },
            totalAgendamentos: result.rows.length
        });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Listar agendamentos
app.get('/api/agendamentos', verificarAcesso, async (req, res) => {
    console.log('📋 Buscando agendamentos para barbearia:', req.barbeariaId);

    try {
        const result = await pool.query(
            'SELECT * FROM agendamentos WHERE barbearia_id = $1 ORDER BY data, hora',
            [req.barbeariaId]
        );

        console.log(`✅ Encontrados ${result.rows.length} agendamentos`);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Erro ao buscar:', error);
        res.status(500).json({ erro: error.message });
    }
});

// Criar agendamento
app.post('/api/agendamentos', verificarAcesso, async (req, res) => {
    const { nome, servico, preco, data, hora, telefone } = req.body;

    try {
        const result = await pool.query(
            `INSERT INTO agendamentos (barbearia_id, nome, servico, preco, data, hora, telefone)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [req.barbeariaId, nome, servico, preco, data, hora, telefone || '']
        );

        res.json({ mensagem: '✅ Agendado com sucesso!', id: result.rows[0].id });
    } catch (error) {
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

// Listar serviços
app.get('/api/servicos', verificarAcesso, async (req, res) => {
    const result = await pool.query('SELECT * FROM servicos WHERE barbearia_id = $1 ORDER BY nome', [req.barbeariaId]);
    res.json(result.rows);
});

// Criar serviço
app.post('/api/servicos', verificarAcesso, async (req, res) => {
    const { nome, descricao, preco, duracao } = req.body;
    const result = await pool.query(
        `INSERT INTO servicos (barbearia_id, nome, descricao, preco, duracao) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [req.barbeariaId, nome, descricao || '', preco, duracao || 30]
    );
    res.json({ id: result.rows[0].id, mensagem: '✅ Serviço criado!' });
});

// Atualizar serviço
app.put('/api/servicos/:id', verificarAcesso, async (req, res) => {
    const { nome, descricao, preco, duracao } = req.body;
    await pool.query(
        `UPDATE servicos SET nome = $1, descricao = $2, preco = $3, duracao = $4 WHERE id = $5 AND barbearia_id = $6`,
        [nome, descricao || '', preco, duracao || 30, req.params.id, req.barbeariaId]
    );
    res.json({ mensagem: '✅ Serviço atualizado!' });
});

// Excluir serviço
app.delete('/api/servicos/:id', verificarAcesso, async (req, res) => {
    await pool.query('DELETE FROM servicos WHERE id = $1 AND barbearia_id = $2', [req.params.id, req.barbeariaId]);
    res.json({ mensagem: '✅ Serviço excluído!' });
});

// Faturamento do mês
app.get('/api/faturamento/mes', verificarAcesso, async (req, res) => {
    try {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = hoje.getMonth() + 1;
        const primeiroDia = `${ano}-${mes.toString().padStart(2, '0')}-01`;
        const ultimoDia = new Date(ano, mes, 0).toISOString().split('T')[0];

        const result = await pool.query(
            `SELECT COALESCE(SUM(preco), 0) as total FROM agendamentos 
             WHERE barbearia_id = $1 AND data >= $2 AND data <= $3`,
            [req.barbeariaId, primeiroDia, ultimoDia]
        );

        res.json({ faturamento: parseFloat(result.rows[0]?.total) || 0 });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
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
    });
});