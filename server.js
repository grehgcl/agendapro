const express = require('express');
const { query, isProd } = require('./db');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'troca-essa-chave-em-producao';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

console.log(`📁 Banco: ${isProd ? 'PostgreSQL/Supabase' : 'SQLite Local'}`);

// ============= CRIAR TABELAS =============
async function criarTabelas() {
    const idType = isProd ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const dateType = isProd ? 'TIMESTAMP' : 'DATETIME';

    await query(`
        CREATE TABLE IF NOT EXISTS barbearias (
            id ${idType},
            nome TEXT NOT NULL,
            cnpj TEXT,
            telefone TEXT,
            email TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL,
            plano TEXT DEFAULT 'trial',
            data_expiracao ${dateType},
            status TEXT DEFAULT 'ativo',
            created_at ${dateType} DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS agendamentos (
            id ${idType},
            barbearia_id INTEGER NOT NULL,
            nome TEXT NOT NULL,
            servico TEXT NOT NULL,
            preco REAL NOT NULL,
            data TEXT NOT NULL,
            hora TEXT NOT NULL,
            telefone TEXT,
            status TEXT DEFAULT 'agendado',
            created_at ${dateType} DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS clientes (
            id ${idType},
            barbearia_id INTEGER NOT NULL,
            nome TEXT NOT NULL,
            email TEXT,
            telefone TEXT,
            data_cadastro ${dateType} DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS servicos (
            id ${idType},
            barbearia_id INTEGER NOT NULL,
            nome TEXT NOT NULL,
            descricao TEXT,
            preco REAL NOT NULL,
            duracao INTEGER DEFAULT 30,
            FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS despesas (
            id ${idType},
            barbearia_id INTEGER NOT NULL,
            descricao TEXT NOT NULL,
            valor REAL NOT NULL,
            categoria TEXT DEFAULT 'outros',
            data DATE NOT NULL,
            pagamento TEXT DEFAULT 'pago',
            observacao TEXT,
            created_at ${dateType} DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS metas (
            id ${idType},
            barbearia_id INTEGER NOT NULL,
            ano INTEGER NOT NULL,
            mes INTEGER NOT NULL,
            valor REAL NOT NULL,
            created_at ${dateType} DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(barbearia_id, ano, mes),
            FOREIGN KEY (barbearia_id) REFERENCES barbearias(id)
        )
    `);

    console.log('✅ Tabelas criadas/verificadas');
}

criarTabelas();

// ============= HELPERS =============
const sql = (querySQL) => {
    if (!isProd) return querySQL;
    let i = 0;
    return querySQL.replace(/\?/g, () => `$${++i}`);
};

// ============= MIDDLEWARE =============
const verificarAcesso = async (req, res, next) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ erro: 'Token não fornecido' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const barbearia = await query(sql('SELECT * FROM barbearias WHERE id =?'), [decoded.id]);

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

// ============= MIDDLEWARE DE PLANOS =============
const limitesPlanos = {
    trial: { agendamentos: 50, clientes: 30, servicos: 5 },
    basico: { agendamentos: 200, clientes: 100, servicos: 15 },
    pro: { agendamentos: 999999, clientes: 999999, servicos: 999999 },
    premium: { agendamentos: 999999, clientes: 999999, servicos: 999999 }
};

const verificarPlano = async (req, res, next) => {
    try {
        const b = req.barbearia;
        const hoje = new Date();

        if (b.plano === 'trial' && b.data_expiracao) {
            const expira = new Date(b.data_expiracao);
            if (expira < hoje) {
                return res.status(403).json({
                    erro: 'Teste expirado',
                    codigo: 'TRIAL_EXPIRED',
                    mensagem: 'Seu período de teste acabou. Faça upgrade para continuar.'
                });
            }
        }

        if (b.plano !== 'trial' && b.status !== 'ativo') {
            return res.status(403).json({
                erro: 'Plano inativo',
                codigo: 'PLAN_INACTIVE',
                mensagem: 'Seu plano está inativo. Regularize o pagamento.'
            });
        }

        req.limites = limitesPlanos[b.plano] || limitesPlanos.trial;
        next();
    } catch (error) {
        console.error('❌ Erro verificarPlano:', error);
        return res.status(500).json({ erro: 'Erro ao verificar plano' });
    }
};

const verificarLimite = (tipo) => async (req, res, next) => {
    try {
        const limite = req.limites[tipo];

        if (!limite || limite >= 999999) return next();

        let total = 0;

        if (tipo === 'agendamentos') {
            const mesAtual = new Date().toISOString().slice(0, 7);
            const result = await query(sql(
                `SELECT COUNT(*) as total FROM agendamentos
                 WHERE barbearia_id =? AND data LIKE? AND status!= 'cancelado'`
            ), [req.barbeariaId, `${mesAtual}%`]);
            total = parseInt(result[0].total) || 0;
        }

        if (tipo === 'clientes') {
            const result = await query(sql(
                `SELECT COUNT(*) as total FROM clientes WHERE barbearia_id =?`
            ), [req.barbeariaId]);
            total = parseInt(result[0].total) || 0;
        }

        if (tipo === 'servicos') {
            const result = await query(sql(
                `SELECT COUNT(*) as total FROM servicos WHERE barbearia_id =?`
            ), [req.barbeariaId]);
            total = parseInt(result[0].total) || 0;
        }

        console.log(`Limite ${tipo}: ${total}/${limite}`);

        if (total >= limite) {
            const nomes = {
                servicos: limite === 1 ? 'serviço' : 'serviços',
                clientes: limite === 1 ? 'cliente' : 'clientes',
                agendamentos: limite === 1 ? 'agendamento' : 'agendamentos'
            };

            return res.status(403).json({
                erro: 'Limite atingido',
                codigo: 'LIMIT_REACHED',
                tipo,
                usado: total,
                limite,
                mensagem: `Você atingiu o limite de ${limite} ${nomes[tipo]} do seu plano. Faça upgrade para adicionar mais.`
            });
        }

        req.usoAtual = { tipo, usado: total, limite };
        next();
    } catch (error) {
        console.error('❌ Erro verificarLimite:', error);
        return res.status(500).json({ erro: 'Erro ao verificar limite' });
    }
};

// ============= ROTAS AUTH =============
app.post('/api/cadastrar-barbearia', async (req, res) => {
    const { nome, email, senha, telefone, cnpj } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios!' });
    }

    try {
        const existe = await query(sql('SELECT id FROM barbearias WHERE email =?'), [email]);
        if (existe.length > 0) {
            return res.status(400).json({ erro: 'Este email já está cadastrado!' });
        }

        const senhaHash = await bcrypt.hash(senha, 10);
        const dataExpiracao = new Date();
        dataExpiracao.setDate(dataExpiracao.getDate() + 14);

        const result = await query(sql(
            `INSERT INTO barbearias (nome, email, senha, telefone, cnpj, data_expiracao)
             VALUES (?,?,?,?,?,?) RETURNING id`
        ), [nome, email, senhaHash, telefone || '', cnpj || '', dataExpiracao.toISOString()]);

        const newId = result[0].id;

        await query(sql(
            `INSERT INTO servicos (barbearia_id, nome, preco, duracao) VALUES
            (?, 'Corte de Cabelo', 35, 30),
            (?, 'Barba', 25, 30),
            (?, 'Corte + Barba', 55, 60)`
        ), [newId, newId, newId]);

        const token = jwt.sign({ id: newId }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            id: newId,
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
        const result = await query(sql('SELECT * FROM barbearias WHERE email =?'), [email]);

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
            query(sql(`SELECT SUM(preco) as total FROM agendamentos
                   WHERE barbearia_id =? AND data LIKE? AND status!= 'cancelado'`),
                [req.barbeariaId, `${mesAtual}%`]),
            query(sql(`SELECT COUNT(*) as total FROM agendamentos
                   WHERE barbearia_id =? AND data LIKE?`),
                [req.barbeariaId, `${mesAtual}%`]),
            query(sql(`SELECT COUNT(*) as total FROM clientes WHERE barbearia_id =?`), [req.barbeariaId]),
            query(sql(`SELECT valor FROM metas WHERE barbearia_id =? AND ano =? AND mes =?`),
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
            sql('SELECT * FROM servicos WHERE barbearia_id =? ORDER BY id DESC'),
            [req.barbeariaId]
        );
        res.json(servicos);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/servicos', verificarAcesso, verificarPlano, verificarLimite('servicos'), async (req, res) => {
    const { nome, preco, duracao, descricao } = req.body;

    if (!nome || !preco) {
        return res.status(400).json({ erro: 'Nome e preço são obrigatórios' });
    }

    try {
        const result = await query(sql(
            'INSERT INTO servicos (barbearia_id, nome, preco, duracao, descricao) VALUES (?,?,?,?,?) RETURNING id'
        ), [req.barbeariaId, nome, preco, duracao || 30, descricao || '']);
        res.json({ id: result[0].id, mensagem: 'Serviço criado' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.put('/api/servicos/:id', verificarAcesso, async (req, res) => {
    const { nome, preco, duracao, descricao } = req.body;
    const { id } = req.params;

    try {
        await query(sql(
            'UPDATE servicos SET nome =?, preco =?, duracao =?, descricao =? WHERE id =? AND barbearia_id =?'
        ), [nome, preco, duracao, descricao, id, req.barbeariaId]);
        res.json({ mensagem: 'Serviço atualizado' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.delete('/api/servicos/:id', verificarAcesso, async (req, res) => {
    const { id } = req.params;

    try {
        await query(sql('DELETE FROM servicos WHERE id =? AND barbearia_id =?'), [id, req.barbeariaId]);
        res.json({ mensagem: 'Serviço excluído' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ============= ROTAS AGENDAMENTOS - ATUALIZADAS =============
app.get('/api/agendamentos', verificarAcesso, async (req, res) => {
    try {
        const agendamentos = await query(sql(
            `SELECT * FROM agendamentos WHERE barbearia_id =?
             ORDER BY data DESC, hora DESC LIMIT 100`
        ), [req.barbeariaId]);
        res.json(agendamentos);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/agendamentos', verificarAcesso, verificarPlano, verificarLimite('agendamentos'), async (req, res) => {
    const { nome, servico, preco, data, hora, telefone } = req.body;

    if (!nome || !servico || !preco || !data || !hora) {
        return res.status(400).json({ erro: 'Dados incompletos' });
    }

    try {
        const result = await query(sql(
            `INSERT INTO agendamentos (barbearia_id, nome, servico, preco, data, hora, telefone)
             VALUES (?,?,?,?,?,?,?) RETURNING id`
        ), [req.barbeariaId, nome, servico, preco, data, hora, telefone || '']);
        res.json({ id: result[0].id, mensagem: 'Agendamento criado' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// EDITAR AGENDAMENTO COMPLETO
app.put('/api/agendamentos/:id', verificarAcesso, async (req, res) => {
    const { nome, servico, preco, data, hora, telefone, status } = req.body;
    const { id } = req.params;

    if (!nome || !servico || !preco || !data || !hora) {
        return res.status(400).json({ erro: 'Dados incompletos' });
    }

    try {
        const result = await query(sql(`
            UPDATE agendamentos
            SET nome =?, servico =?, preco =?, data =?, hora =?, telefone =?, status =?
            WHERE id =? AND barbearia_id =?
        `), [nome, servico, preco, data, hora, telefone || '', status || 'agendado', id, req.barbeariaId]);

        const changed = isProd ? result.rowCount : result.changes;
        if (changed === 0) {
            return res.status(404).json({ erro: 'Agendamento não encontrado' });
        }

        res.json({ mensagem: 'Agendamento atualizado' });
    } catch (error) {
        console.error('Erro editar agendamento:', error);
        res.status(500).json({ erro: error.message });
    }
});

// CANCELAR AGENDAMENTO
app.patch('/api/agendamentos/:id/cancelar', verificarAcesso, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await query(sql(
            'UPDATE agendamentos SET status =? WHERE id =? AND barbearia_id =?'
        ), ['cancelado', id, req.barbeariaId]);

        const changed = isProd ? result.rowCount : result.changes;
        if (changed === 0) {
            return res.status(404).json({ erro: 'Agendamento não encontrado' });
        }

        res.json({ mensagem: 'Agendamento cancelado' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// DELETAR AGENDAMENTO
app.delete('/api/agendamentos/:id', verificarAcesso, async (req, res) => {
    const { id } = req.params;

    try {
        await query(sql(
            'DELETE FROM agendamentos WHERE id =? AND barbearia_id =?'
        ), [id, req.barbeariaId]);

        res.json({ mensagem: 'Agendamento excluído' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ============= ROTAS CLIENTES =============
app.get('/api/clientes', verificarAcesso, async (req, res) => {
    try {
        const clientes = await query(
            sql('SELECT * FROM clientes WHERE barbearia_id =? ORDER BY nome'),
            [req.barbeariaId]
        );
        res.json(clientes);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/clientes', verificarAcesso, verificarPlano, verificarLimite('clientes'), async (req, res) => {
    const { nome, telefone, email } = req.body;

    if (!nome || !telefone) {
        return res.status(400).json({ erro: 'Nome e telefone são obrigatórios' });
    }

    try {
        const result = await query(sql(
            'INSERT INTO clientes (barbearia_id, nome, telefone, email) VALUES (?,?,?,?) RETURNING id'
        ), [req.barbeariaId, nome, telefone, email || null]);

        res.status(201).json({
            id: result[0].id,
            mensagem: 'Cliente cadastrado'
        });
    } catch (error) {
        console.error('❌ Erro cliente:', error);
        res.status(500).json({ erro: 'Erro ao salvar cliente' });
    }
});

// ============= ROTAS DESPESAS =============
app.get('/api/despesas', verificarAcesso, async (req, res) => {
    try {
        const despesas = await query(
            sql('SELECT * FROM despesas WHERE barbearia_id =? ORDER BY data DESC'),
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
        const result = await query(sql(
            `INSERT INTO despesas (barbearia_id, descricao, valor, categoria, data, pagamento, observacao)
             VALUES (?,?,?,?,?,?,?) RETURNING id`
        ), [req.barbeariaId, descricao, valor, categoria || 'outros', data, pagamento || 'pago', observacao || '']);

        res.status(201).json({
            id: result[0].id,
            mensagem: 'Despesa cadastrada'
        });
    } catch (error) {
        console.error('❌ Erro despesa:', error);
        res.status(500).json({ erro: 'Erro ao salvar despesa' });
    }
});

// ============= ROTAS META =============
app.get('/api/meta', verificarAcesso, async (req, res) => {
    const { ano, mes } = req.query;

    if (!ano || !mes) {
        return res.status(400).json({ erro: 'Dados incompletos' });
    }

    try {
        const result = await query(sql(
            'SELECT * FROM metas WHERE barbearia_id =? AND ano =? AND mes =?'
        ), [req.barbeariaId, ano, mes]);
        res.json({ valor: result[0] ? result[0].valor : 0 });
    } catch (error) {
        res.status(500).json({ erro: 'Erro no banco' });
    }
});

app.post('/api/meta', verificarAcesso, async (req, res) => {
    const { ano, mes, valor } = req.body;

    if (!ano || !mes || valor === undefined) {
        return res.status(400).json({ erro: 'Dados incompletos' });
    }

    try {
        const sqlQuery = isProd
            ? `INSERT INTO metas (barbearia_id, ano, mes, valor) VALUES ($1, $2, $3, $4)
               ON CONFLICT(barbearia_id, ano, mes) DO UPDATE SET valor = $4 RETURNING id`
            : `INSERT INTO metas (barbearia_id, ano, mes, valor) VALUES (?,?,?,?)
               ON CONFLICT(barbearia_id, ano, mes) DO UPDATE SET valor =?`;

        const params = isProd
            ? [req.barbeariaId, ano, mes, valor]
            : [req.barbeariaId, ano, mes, valor, valor];

        await query(sqlQuery, params);
        res.json({ sucesso: true });
    } catch (error) {
        console.error('Erro ao salvar meta:', error);
        res.status(500).json({ erro: 'Erro ao salvar meta' });
    }
});

// ============= ROTAS PLANOS =============
app.get('/api/planos', async (req, res) => {
    const planos = [
        {
            id: 'trial',
            nome: 'Trial',
            preco: 0,
            limite_agendamentos: 50,
            limite_clientes: 30,
            limite_servicos: 5
        },
        {
            id: 'basico',
            nome: 'Básico',
            preco: 29.90,
            limite_agendamentos: 200,
            limite_clientes: 100,
            limite_servicos: 15
        },
        {
            id: 'pro',
            nome: 'Pro',
            preco: 59.90,
            limite_agendamentos: 999999,
            limite_clientes: 999999,
            limite_servicos: 999999
        },
        {
            id: 'premium',
            nome: 'Premium',
            preco: 99.90,
            limite_agendamentos: 999999,
            limite_clientes: 999999,
            limite_servicos: 999999
        }
    ];
    res.json(planos);
});

app.get('/api/plano', verificarAcesso, verificarPlano, async (req, res) => {
    try {
        const b = req.barbearia;
        const mesAtual = new Date().toISOString().slice(0, 7);

        const [agend, cli, serv] = await Promise.all([
            query(sql(`SELECT COUNT(*) as total FROM agendamentos WHERE barbearia_id =? AND data LIKE? AND status!= 'cancelado'`),
                [req.barbeariaId, `${mesAtual}%`]),
            query(sql(`SELECT COUNT(*) as total FROM clientes WHERE barbearia_id =?`), [req.barbeariaId]),
            query(sql(`SELECT COUNT(*) as total FROM servicos WHERE barbearia_id =?`), [req.barbeariaId])
        ]);

        const planosInfo = {
            trial: { nome: 'Trial', preco: 0 },
            basico: { nome: 'Básico', preco: 29.90 },
            pro: { nome: 'Pro', preco: 59.90 },
            premium: { nome: 'Premium', preco: 99.90 }
        };

        const info = planosInfo[b.plano] || planosInfo.trial;

        res.json({
            nome: info.nome,
            preco: info.preco,
            status: b.plano === 'trial' ? 'trial' : 'ativo',
            data_fim: b.data_expiracao,
            limites: {
                agendamentos: { usado: parseInt(agend[0].total) || 0, total: req.limites.agendamentos },
                clientes: { usado: parseInt(cli[0].total) || 0, total: req.limites.clientes },
                servicos: { usado: parseInt(serv[0].total) || 0, total: req.limites.servicos }
            }
        });
    } catch (error) {
        console.error('Erro ao buscar plano:', error);
        res.status(500).json({ erro: 'Erro ao buscar plano' });
    }
});

app.get('/api/plano/status', verificarAcesso, verificarPlano, async (req, res) => {
    try {
        const b = req.barbearia;
        const hoje = new Date();
        const expira = new Date(b.data_expiracao);
        const diasRestantes = Math.ceil((expira - hoje) / (1000 * 60 * 60 * 24));
        const mesAtual = hoje.toISOString().slice(0, 7);

        const [agend, cli, serv] = await Promise.all([
            query(sql(`SELECT COUNT(*) as total FROM agendamentos WHERE barbearia_id =? AND data LIKE? AND status!= 'cancelado'`),
                [req.barbeariaId, `${mesAtual}%`]),
            query(sql(`SELECT COUNT(*) as total FROM clientes WHERE barbearia_id =?`), [req.barbeariaId]),
            query(sql(`SELECT COUNT(*) as total FROM servicos WHERE barbearia_id =?`), [req.barbeariaId])
        ]);

        res.json({
            plano: b.plano,
            status: b.status,
            data_expiracao: b.data_expiracao,
            dias_restantes: diasRestantes > 0 ? diasRestantes : 0,
            limites: req.limites,
            uso: {
                agendamentos: parseInt(agend[0].total) || 0,
                clientes: parseInt(cli[0].total) || 0,
                servicos: parseInt(serv[0].total) || 0
            }
        });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.get('/api/planos/atual', verificarAcesso, async (req, res) => {
    try {
        const b = req.barbearia;
        res.json({
            nome: b.plano,
            limite: limitesPlanos[b.plano] || limitesPlanos.trial
        });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/assinatura/upgrade', verificarAcesso, async (req, res) => {
    const { plano_id } = req.body;

    const planosValidos = ['basico', 'pro', 'premium'];

    if (!plano_id || !planosValidos.includes(plano_id)) {
        return res.status(400).json({ erro: 'Plano inválido' });
    }

    try {
        const novaDataExpiracao = new Date();
        novaDataExpiracao.setDate(novaDataExpiracao.getDate() + 30);

        await query(sql(
            'UPDATE barbearias SET plano =?, status =?, data_expiracao =? WHERE id =?'
        ), [plano_id, 'ativo', novaDataExpiracao.toISOString(), req.barbeariaId]);

        res.json({
            mensagem: `Upgrade para ${plano_id} realizado com sucesso!`,
            plano: plano_id,
            expira_em: novaDataExpiracao
        });
    } catch (error) {
        console.error('Erro no upgrade:', error);
        res.status(500).json({ erro: 'Erro ao fazer upgrade' });
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
        const result = await query(sql('SELECT * FROM barbearias WHERE id =?'), [req.params.id]);
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
        let sqlQuery = 'UPDATE barbearias SET nome =?, email =?, telefone =?, cnpj =?, plano =?';
        let params = [nome, email, telefone, cnpj, plano];

        if (senha && senha.trim() !== '') {
            const senhaHash = await bcrypt.hash(senha, 10);
            sqlQuery += ', senha =?';
            params.push(senhaHash);
        }

        sqlQuery += ' WHERE id =?';
        params.push(id);

        await query(sql(sqlQuery), params);
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
            const atual = await query(sql('SELECT data_expiracao FROM barbearias WHERE id =?'), [id]);
            let novaData = new Date(atual[0].data_expiracao || new Date());
            novaData.setDate(novaData.getDate() + parseInt(dias_extras));

            await query(sql(
                'UPDATE barbearias SET status =?, data_expiracao =? WHERE id =?'
            ), [status, novaData.toISOString(), id]);
        } else {
            await query(sql('UPDATE barbearias SET status =? WHERE id =?'), [status, id]);
        }

        res.json({ mensagem: 'Status atualizado' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.delete('/api/admin/barbearias/:id', verificarAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        await query(sql('DELETE FROM agendamentos WHERE barbearia_id =?'), [id]);
        await query(sql('DELETE FROM clientes WHERE barbearia_id =?'), [id]);
        await query(sql('DELETE FROM servicos WHERE barbearia_id =?'), [id]);
        await query(sql('DELETE FROM metas WHERE barbearia_id =?'), [id]);
        await query(sql('DELETE FROM despesas WHERE barbearia_id =?'), [id]);
        await query(sql('DELETE FROM barbearias WHERE id =?'), [id]);

        res.json({ mensagem: 'Barbearia excluída com sucesso' });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/admin/barbearias/:id/reset-senha', verificarAdmin, async (req, res) => {
    const novaSenha = Math.random().toString(36).slice(-8);
    const senhaHash = await bcrypt.hash(novaSenha, 10);

    await query(sql('UPDATE barbearias SET senha =? WHERE id =?'), [senhaHash, req.params.id]);
    res.json({ mensagem: 'Senha resetada', novaSenha });
});

// ============= ERROR HANDLER =============
app.use((err, req, res, next) => {
    console.error('❌ Erro:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ============= SERVIDOR =============
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📁 Banco: ${isProd ? 'PostgreSQL/Supabase' : 'SQLite Local'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🔒 Encerrando...');
    process.exit(0);
});