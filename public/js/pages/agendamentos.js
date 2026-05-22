// /public/js/pages/agendamentos.js
let agendamentos = [];

async function carregarAgendamentos() {
    try {
        console.log('Carregando agendamentos...');
        const dados = await apiGet('/agendamentos');
        console.log('Dados recebidos:', dados);

        // Aceita array direto OU objeto com propriedade agendamentos
        agendamentos = Array.isArray(dados) ? dados : (dados.agendamentos || []);

        exibirAgendamentos(agendamentos);
        document.getElementById('totalAgendamentos').textContent = agendamentos.length;

    } catch (error) {
        console.error('Erro ao carregar:', error);
        document.getElementById('listaAgendamentos').innerHTML = `
            <tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 20px;">
                ❌ Erro: ${error.message}
            </td></tr>
        `;
    }
}

function exibirAgendamentos(lista) {
    const tbody = document.getElementById('listaAgendamentos');

    if (!lista || lista.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="7" style="text-align: center; color: #9ca3af; padding: 40px;">
                📭 Nenhum agendamento encontrado
            </td></tr>
        `;
        return;
    }

    tbody.innerHTML = lista.map(a => `
        <tr>
            <td><strong>${escapeHtml(a.nome || a.cliente || '-')}</strong></td>
            <td>${escapeHtml(a.servico || '-')}</td>
            <td>${formatarData(a.data)}</td>
            <td>${a.hora || '-'}</td>
            <td>R$ ${formatMoney(a.preco || 0)}</td>
            <td><span class="status status-${a.status}">${formatarStatus(a.status)}</span></td>
            <td>
                <button class="btn btn-edit" onclick="editar(${a.id})">✏️</button>
                ${a.status === 'agendado' ? `<button class="btn btn-cancel" onclick="cancelar(${a.id})">🚫</button>` : ''}
                <button class="btn btn-delete" onclick="deletar(${a.id})">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function editar(id) {
    location.href = `agendamento.html?id=${id}`;
}

async function cancelar(id) {
    if (!confirm('Cancelar esse agendamento?')) return;
    try {
        await apiPost(`/agendamentos/${id}/cancelar`, {});
        alert('✅ Cancelado!');
        carregarAgendamentos();
    } catch (error) {
        alert('Erro ao cancelar: ' + error.message);
    }
}

async function deletar(id) {
    if (!confirm('Excluir permanentemente?')) return;
    try {
        await apiDelete(`/agendamentos/${id}`);
        alert('✅ Excluído!');
        carregarAgendamentos();
    } catch (error) {
        alert('Erro ao excluir: ' + error.message);
    }
}

function filtrarAgendamentos() {
    const dataFiltro = document.getElementById('filtroData').value;
    const statusFiltro = document.getElementById('filtroStatus').value;

    const filtrados = agendamentos.filter(ag => {
        const matchData = !dataFiltro || ag.data === dataFiltro;
        const matchStatus = !statusFiltro || ag.status === statusFiltro;
        return matchData && matchStatus;
    });

    exibirAgendamentos(filtrados);
    document.getElementById('totalAgendamentos').textContent = filtrados.length;
}

function formatarData(data) {
    if (!data) return '-';
    return data.split('-').reverse().join('/');
}

function formatarStatus(status) {
    const map = {
        'agendado': 'Agendado',
        'concluido': 'Concluído',
        'cancelado': 'Cancelado'
    };
    return map[status] || status || '-';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    const auth = getAuth();
    if (!auth) {
        window.location.href = 'login-barbearia.html';
        return;
    }

    // Preenche dados do usuário se os elementos existirem
    const userNome = document.getElementById('userNome');
    const userEmail = document.getElementById('userEmail');
    const userAvatar = document.getElementById('userAvatar');

    if (userNome) userNome.textContent = auth.nome || 'Admin';
    if (userEmail) userEmail.textContent = auth.email;
    if (userAvatar) userAvatar.textContent = (auth.nome || 'A')[0].toUpperCase();

    // Event listeners
    const btnNovo = document.getElementById('btnNovoAgendamento');
    if (btnNovo) btnNovo.addEventListener('click', () => location.href = 'agendamento.html');

    const filtroData = document.getElementById('filtroData');
    const filtroStatus = document.getElementById('filtroStatus');
    if (filtroData) filtroData.addEventListener('change', filtrarAgendamentos);
    if (filtroStatus) filtroStatus.addEventListener('change', filtrarAgendamentos);

    carregarAgendamentos();
});