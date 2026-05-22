// /public/js/pages/servicos.js

let servicos = [];
let servicoEditandoId = null;

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('show');
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.onclick = toggleSidebar;
        document.body.appendChild(overlay);
    }
    overlay.classList.toggle('show');
}

async function carregarServicos() {
    const tbody = document.getElementById('listaServicos');
    tbody.innerHTML = `
        <tr>
            <td colspan="5" class="loading">
                <div class="spinner"></div>
                <span>Carregando...</span>
            </td>
        </tr>
    `;

    try {
        console.log('1. Chamando apiGet...');
        const response = await apiGet('/servicos');
        console.log('2. Resposta recebida:', response);

        servicos = Array.isArray(response) ? response : [];
        console.log('3. Serviços processados:', servicos.length);

        exibirServicos();
    } catch (error) {
        console.error('4. ERRO NO CARREGAR:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: #ef4444; padding: 40px;">
                    ❌ Erro: ${error.message}<br>
                    <small>Abre o Console F12 pra ver detalhes</small>
                </td>
            </tr>
        `;
    }
}

function exibirServicos() {
    const tbody = document.getElementById('listaServicos');

    if (!servicos || servicos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    📭 Nenhum serviço cadastrado ainda.<br>
                    <small>Clique em "Novo Serviço" para começar</small>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = servicos.map(s => `
        <tr>
            <td><strong>${escapeHtml(s.nome)}</strong></td>
            <td>R$ ${formatMoney(s.preco)}</td>
            <td>${s.duracao || 0} min</td>
            <td>${escapeHtml(s.descricao) || '-'}</td>
            <td>
                <button class="btn btn-edit" onclick="abrirModal(${s.id})">✏️</button>
                <button class="btn btn-delete" onclick="excluirServico(${s.id}, '${escapeHtml(s.nome)}')">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function abrirModal(id = null) {
    servicoEditandoId = id;
    const modal = document.getElementById('modalServico');

    if (id) {
        const servico = servicos.find(s => s.id === id);
        document.getElementById('modalTitle').textContent = '✏️ Editar Serviço';
        document.getElementById('servicoNome').value = servico.nome;
        document.getElementById('servicoDescricao').value = servico.descricao || '';
        document.getElementById('servicoPreco').value = servico.preco;
        document.getElementById('servicoDuracao').value = servico.duracao || 30;
    } else {
        document.getElementById('modalTitle').textContent = '➕ Novo Serviço';
        document.getElementById('servicoNome').value = '';
        document.getElementById('servicoDescricao').value = '';
        document.getElementById('servicoPreco').value = '';
        document.getElementById('servicoDuracao').value = '30';
    }

    modal.style.display = 'flex';
}

function fecharModal() {
    document.getElementById('modalServico').style.display = 'none';
    servicoEditandoId = null;
}

async function salvarServico() {
    const nome = document.getElementById('servicoNome').value.trim();
    const descricao = document.getElementById('servicoDescricao').value.trim();
    const precoStr = document.getElementById('servicoPreco').value.replace(',', '.');
    const duracaoStr = document.getElementById('servicoDuracao').value;

    if (!nome) {
        alert('Nome é obrigatório');
        return;
    }

    if (!precoStr || isNaN(precoStr)) {
        alert('Preço inválido');
        return;
    }

    const dados = {
        nome: nome,
        descricao: descricao || null,
        preco: parseFloat(precoStr),
        duracao: parseInt(duracaoStr) || 30
    };

    console.log('Enviando dados:', dados);

    try {
        if (servicoEditandoId) {
            await apiPut(`/servicos/${servicoEditandoId}`, dados);
        } else {
            await apiPost('/servicos', dados);
        }

        fecharModal();
        await carregarServicos();
        mostrarToast('Serviço salvo com sucesso!');
    } catch (error) {
        console.error('Erro completo ao salvar:', error);
        alert('Erro ao salvar: ' + error.message);
    }
}

async function excluirServico(id, nome) {
    if (confirm(`Tem certeza que deseja excluir "${nome}"?\n\nOs agendamentos com este serviço serão afetados.`)) {
        try {
            await apiDelete(`/servicos/${id}`);
            mostrarToast('✅ Serviço excluído!');
            await carregarServicos();
        } catch (error) {
            mostrarToast('Erro ao excluir: ' + error.message, true);
        }
    }
}

function mostrarToast(mensagem, erro = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${erro ? 'erro' : ''}`;
    toast.textContent = mensagem;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// INICIALIZA TUDO QUANDO O DOM CARREGAR
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM carregado, iniciando serviços...');

    renderSidebar('servicos');
    carregarServicos();

    const btnNovo = document.getElementById('btnNovoServico');
    if (btnNovo) {
        btnNovo.addEventListener('click', () => abrirModal());
        console.log('Botão novo serviço conectado');
    }

    const modal = document.getElementById('modalServico');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'modalServico') fecharModal();
        });
    }
});