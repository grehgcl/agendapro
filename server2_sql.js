const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'troca-essa-chave-em-producao';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============= SQLITE =============
console.log('📁 Iniciando com SQLite');

const isRailway = process.env.RAILWAY_ENVIRONMENT;
const dbPath = isRailway ? '/data/agendapro.db' : path.join(__dirname, 'agendapro.db');

console.log('📁 Banco em:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Erro SQLite:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Banco SQLite conectado!');
    }
});

// ============= CRIAR TABELAS =============
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS barbearias (
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

    db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barbearia_id INTEGER NOT NULL,
        nome TEXT NOT NULL,
        servico TEXT NOT NULL,
        preco REAL NOT NULL,
        data TEXT NOT NULL,
        hora TEXT NOT NULL,
        telefone TEXT,
        status TEXT DEFAULT 'agendado',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barbearia_id INTEGER NOT NULL,
        nome TEXT NOT NULL,
        email TEXT,
        telefone TEXT,
        data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS servicos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barbearia_id INTEGER NOT NULL,
        nome TEXT NOT NULL,
        descricao TEXT,
        preco REAL NOT NULL,
        duracao INTEGER DEFAULT 30,
        FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS metas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barbearia_id INTEGER NOT NULL,
        ano INTEGER NOT NULL,
        mes INTEGER NOT NULL,
        valor REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(barbearia_id, ano, mes),
        FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS despesas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barbearia_id INTEGER NOT NULL,
        descricao TEXT NOT NULL,
        valor REAL NOT NULL,
        categoria TEXT DEFAULT 'outros',
        data DATE NOT NULL,
        pagamento TEXT DEFAULT 'pago',
        observacao TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS metas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barbearia_id INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    valor REAL NOT NULL,
    UNIQUE(barbearia_id, ano, mes)
)`);

    console.log('✅ Tabelas SQLite criadas/verificadas');
});

// ============= HELPERS =============
const query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
};

// ============= MIDDLEWARE =============
const verificarAcesso = async (req, res, next) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ erro: 'Token não fornecido' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const barbearia = await query('SELECT * FROM barbearias WHERE id =?', [decoded.id]);

        if (barbearia.length === 0) {
            return res.status(401).json({ erro: 'Barbearia não encontrada' });
        }

        req.barbearia = barbearia[0];
        req.barbeariaId = decoded.id;
        next();
    } catch (error) {
        return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
};

// ============= ROTAS AUTH =============
app.post('/api/cadastrar-barbearia', async (req, res) => {
    const { nome, email, senha, telefone, cnpj } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios!' });
    }

    try {
        const existe = await query('SELECT id FROM barbearias WHERE email =?', [email]);
        if (existe.length > 0) {
            return res.status(400).json({ erro: 'Este email já está cadastrado!' });
        }

        const senhaHash = await bcrypt.hash(senha, 10);
        const dataExpiracao = new Date();
        dataExpiracao.setDate(dataExpiracao.getDate() + 14);

        const result = await run(
            `INSERT INTO barbearias (nome, email, senha, telefone, cnpj, data_expiracao)
             VALUES (?,?,?,?,?,?)`,
            [nome, email, senhaHash, telefone || '', cnpj || '', dataExpiracao.toISOString()]
        );

        await run(
            `INSERT INTO servicos (barbearia_id, nome, preco, duracao) VALUES
            (?, 'Corte de Cabelo', 35, 30),
            (?, 'Barba', 25, 30),
            (?, 'Corte + Barba', 55, 60)`,
            [result.lastID, result.lastID, result.lastID]
        );

        const token = jwt.sign({ id: result.lastID }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            id: result.lastID,
            token,
            mensagem: '✅ Cadastrado com sucesso!'
        });
    } catch (error) {
        console.error('❌ Erro cadastro:', error);
        res.status(500).json({ erro: 'Erro ao cadastrar' });
    }
});

app.post('/api/login-barbearia', async (req, res) => {
    const { email, senha } = req.body;

    try {
        const result = await query('SELECT * FROM barbearias WHERE email =?', [email]);

        if (result.length === 0) {
            return res.status(401).json({ erro: 'Email ou senha inválidos!' });
        }

        const barbearia = result[0];
        const senhaValida = await bcrypt.compare(senha, barbearia.senha);

        if (!senhaValida) {
            return res.status(401).json({ erro: 'Email ou senha inválidos!' });
        }

        const token = jwt.sign({ id: barbearia.id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            id: barbearia.id,
            nome: barbearia.nome,
            email: barbearia.email,
            token
        });
    } catch (error) {
        console.error('❌ Erro login:', error);
        res.status(500).json({ erro: 'Erro ao fazer login' });
    }
});

// ============= ROTAS DASHBOARD =============
app.get('/api/dashboard', verificarAcesso, async (req, res) => {
    try {
        const mesAtual = new Date().toISOString().slice(0, 7);

        const [faturamento, agendamentos, clientes, meta] = await Promise.all([
            query(`SELECT SUM(preco) as total FROM agendamentos
                   WHERE barbearia_id =? AND data LIKE? AND status!= 'cancelado'`,
                [req.barbeariaId, `${mesAtual}%`]),
            query(`SELECT COUNT(*) as total FROM agendamentos
                   WHERE barbearia_id =? AND data LIKE?`,
                [req.barbeariaId, `${mesAtual}%`]),
            query(`SELECT COUNT(*) as total FROM clientes WHERE barbearia_id =?`, [req.barbeariaId]),
            query(`SELECT valor FROM metas WHERE barbearia_id =? AND ano =? AND mes =?`,
                [req.barbeariaId, new Date().getFullYear(), new Date().getMonth() + 1])
        ]);

        res.json({
            faturamento: faturamento[0].total || 0,
            agendamentos: agendamentos[0].total || 0,
            clientes: clientes[0].total || 0,
            meta: meta[0]?.valor || 0
        });
    } catch (error) {
        console.error('❌ Erro dashboard:', error);
        res.status(500).json({ erro: 'Erro ao carregar dashboard' });
    }
});

// ============= ROTAS SERVIÇOS =============
app.get('/api/servicos', verificarAcesso, async (req, res) => {
    try {
        const servicos = await query(
            'SELECT * FROM servicos WHERE barbearia_id =? ORDER BY id DESC',
            [req.barbeariaId]
        );
        res.json(servicos);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/servicos', verificarAcesso, async (req, res) => {
    const { nome, preco, duracao, descricao } = req.body;

    if (!nome || !preco) {
        return res.status(400).json({ erro: 'Nome e preço são obrigatórios' });
    }

    try {
        const result = await run(
            'INSERT INTO servicos (barbearia_id, nome, preco, duracao, descricao) VALUES (?,?,?,?,?)',
            [req.barbeariaId, nome, preco, duracao || 30, descricao || '']
        );
        res.json({ id: result.lastID, mensagem: 'Serviço criado' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ============= ROTAS AGENDAMENTOS =============
app.get('/api/agendamentos', verificarAcesso, async (req, res) => {
    try {
        const agendamentos = await query(
            `SELECT * FROM agendamentos WHERE barbearia_id =?
             ORDER BY data DESC, hora DESC LIMIT 100`,
            [req.barbeariaId]
        );
        res.json(agendamentos);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/agendamentos', verificarAcesso, async (req, res) => {
    const { nome, servico, preco, data, hora, telefone } = req.body;

    if (!nome || !servico || !preco || !data || !hora) {
        return res.status(400).json({ erro: 'Dados incompletos' });
    }

    try {
        const result = await run(
            `INSERT INTO agendamentos (barbearia_id, nome, servico, preco, data, hora, telefone)
             VALUES (?,?,?,?,?,?,?)`,
            [req.barbeariaId, nome, servico, preco, data, hora, telefone || '']
        );
        res.json({ id: result.lastID, mensagem: 'Agendamento criado' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ============= ROTAS CLIENTES =============
app.get('/api/clientes', verificarAcesso, async (req, res) => {
    try {
        const clientes = await query(
            'SELECT * FROM clientes WHERE barbearia_id =? ORDER BY nome',
            [req.barbeariaId]
        );
        res.json(clientes);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/clientes', verificarAcesso, async (req, res) => {
    const { nome, telefone, email } = req.body;

    if (!nome || !telefone) {
        return res.status(400).json({ erro: 'Nome e telefone são obrigatórios' });
    }

    try {
        const result = await run(
            'INSERT INTO clientes (barbearia_id, nome, telefone, email) VALUES (?,?,?,?)',
            [req.barbeariaId, nome, telefone, email || null]
        );

        res.status(201).json({
            id: result.lastID,
            mensagem: 'Cliente cadastrado'
        });
    } catch (error) {
        console.error('❌ Erro cliente:', error);
        res.status(500).json({ erro: 'Erro ao salvar cliente' });
    }
});

// ============= HEALTH CHECK =============
app.get('/', (req, res) => {
    res.send('🚀 AgendaPro online!');
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============= ROTAS ADMIN =============
app.post('/api/login-admin', async (req, res) => {
    const { username, senha } = req.body;

    if (username === 'superadmin' && senha === 'admin123') {
        const token = jwt.sign({ admin: true, user: 'superadmin' }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, mensagem: 'Login admin ok' });
    } else {
        res.status(401).json({ erro: 'Acesso negado' });
    }
});

const verificarAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ erro: 'Token não fornecido' });

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded.admin) throw new Error('Não é admin');
        req.admin = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ erro: 'Token admin inválido' });
    }
};

app.get('/api/admin/barbearias', verificarAdmin, async (req, res) => {
    try {
        const barbearias = await query('SELECT id, nome, email, telefone, cnpj, plano, data_expiracao, status FROM barbearias ORDER BY id DESC');
        res.json(barbearias);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.get('/api/admin/barbearias/:id', verificarAdmin, async (req, res) => {
    try {
        const result = await query('SELECT * FROM barbearias WHERE id =?', [req.params.id]);
        if (result.length === 0) return res.status(404).json({ erro: 'Não encontrada' });
        delete result[0].senha;
        res.json(result[0]);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.put('/api/admin/barbearias/:id', verificarAdmin, async (req, res) => {
    const { nome, email, telefone, cnpj, senha, plano } = req.body;
    const { id } = req.params;

    try {
        let sql = 'UPDATE barbearias SET nome =?, email =?, telefone =?, cnpj =?, plano =?';
        let params = [nome, email, telefone, cnpj, plano];

        if (senha && senha.trim() !== '') {
            const senhaHash = await bcrypt.hash(senha, 10);
            sql += ', senha =?';
            params.push(senhaHash);
        }

        sql += ' WHERE id =?';
        params.push(id);

        await run(sql, params);
        res.json({ mensagem: 'Barbearia atualizada' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.put('/api/admin/barbearias/:id/status', verificarAdmin, async (req, res) => {
    const { status, dias_extras } = req.body;
    const { id } = req.params;

    try {
        if (dias_extras) {
            const atual = await query('SELECT data_expiracao FROM barbearias WHERE id =?', [id]);
            let novaData = new Date(atual[0].data_expiracao || new Date());
            novaData.setDate(novaData.getDate() + parseInt(dias_extras));

            await run(
                'UPDATE barbearias SET status =?, data_expiracao =? WHERE id =?',
                [status, novaData.toISOString(), id]
            );
        } else {
            await run('UPDATE barbearias SET status =? WHERE id =?', [status, id]);
        }

        res.json({ mensagem: 'Status atualizado' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.delete('/api/admin/barbearias/:id', verificarAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        await run('DELETE FROM agendamentos WHERE barbearia_id =?', [id]);
        await run('DELETE FROM clientes WHERE barbearia_id =?', [id]);
        await run('DELETE FROM servicos WHERE barbearia_id =?', [id]);
        await run('DELETE FROM metas WHERE barbearia_id =?', [id]);
        await run('DELETE FROM despesas WHERE barbearia_id =?', [id]);
        await run('DELETE FROM barbearias WHERE id =?', [id]);

        res.json({ mensagem: 'Barbearia excluída com sucesso' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/admin/barbearias/:id/reset-senha', verificarAdmin, async (req, res) => {
    const novaSenha = Math.random().toString(36).slice(-8);
    const senhaHash = await bcrypt.hash(novaSenha, 10);

    await run('UPDATE barbearias SET senha =? WHERE id =?', [senhaHash, req.params.id]);
    res.json({ mensagem: 'Senha resetada', novaSenha });
});

// ============= ERROR HANDLER =============
app.use((err, req, res, next) => {
    console.error('❌ Erro:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
});

// BUSCAR META DO MÊS
app.get('/api/meta', (req, res) => {
    const barbeariaId = req.headers['authorization']?.replace('Bearer ', '');
    const { ano, mes } = req.query;

    if (!barbeariaId || !ano || !mes) {
        return res.status(400).json({ erro: 'Dados incompletos' });
    }

    db.get(
        'SELECT * FROM metas WHERE barbearia_id = ? AND ano = ? AND mes = ?',
        [barbeariaId, ano, mes],
        (err, row) => {
            if (err) return res.status(500).json({ erro: 'Erro no banco' });
            res.json({ valor: row ? row.valor : 0 });
        }
    );
});

// SALVAR/ATUALIZAR META
app.post('/api/meta', (req, res) => {
    const barbeariaId = req.headers['authorization']?.replace('Bearer ', '');
    const { ano, mes, valor } = req.body;

    if (!barbeariaId || !ano || !mes || valor === undefined) {
        return res.status(400).json({ erro: 'Dados incompletos' });
    }

    // UPSERT: insere ou atualiza se já existir
    db.run(
        `INSERT INTO metas (barbearia_id, ano, mes, valor) 
         VALUES (?, ?, ?, ?) 
         ON CONFLICT(barbearia_id, ano, mes) 
         DO UPDATE SET valor = ?`,
        [barbeariaId, ano, mes, valor, valor],
        function (err) {
            if (err) {
                console.error('Erro ao salvar meta:', err);
                return res.status(500).json({ erro: 'Erro ao salvar meta' });
            }
            res.json({ sucesso: true, id: this.lastID });
        }
    );
});

// COLA A ROTA DO PLANO AQUI 👇
app.get('/api/planos/atual', verificarAcesso, async (req, res) => {
    try {
        const b = await query('SELECT plano FROM barbearias WHERE id =?', [req.barbeariaId]);
        res.json({ nome: b[0]?.plano || 'Grátis', limite: 'Sem limite' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ============= SERVIDOR =============
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📁 SQLite: ${dbPath}`);
});

// ============= ROTAS DESPESAS =============
app.get('/api/despesas', verificarAcesso, async (req, res) => {
    try {
        const despesas = await query(
            'SELECT * FROM despesas WHERE barbearia_id =? ORDER BY data DESC',
            [req.barbeariaId]
        );
        res.json(despesas);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/despesas', verificarAcesso, async (req, res) => {
    const { descricao, valor, categoria, data, pagamento, observacao } = req.body;

    if (!descricao || !valor || !data) {
        return res.status(400).json({ erro: 'Descrição, valor e data são obrigatórios' });
    }

    try {
        const result = await run(
            `INSERT INTO despesas (barbearia_id, descricao, valor, categoria, data, pagamento, observacao) 
             VALUES (?,?,?,?,?,?,?)`,
            [req.barbeariaId, descricao, valor, categoria || 'outros', data, pagamento || 'pago', observacao || '']
        );

        res.status(201).json({
            id: result.lastID,
            mensagem: 'Despesa cadastrada'
        });
    } catch (error) {
        console.error('❌ Erro despesa:', error);
        res.status(500).json({ erro: 'Erro ao salvar despesa' });
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close(() => {
        console.log('🔒 Banco fechado');
        process.exit(0);
    });
});