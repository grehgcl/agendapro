// /public/js/pages/agendamento.js
const urlParams = new URLSearchParams(window.location.search);
const editId = urlParams.get('id');
const isEdicao = !!editId;
let todosAgendamentos = [];

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

function gerarHorarios() {
    const horarios = [];
    for (let i = 9; i <= 19; i++) {
        horarios.push(`${i.toString().padStart(2, '0')}:00`);
        if (i !== 19) horarios.push(`${i.toString().padStart(2, '0')}:30`);
    }
    return horarios;
}

async function carregarServicos() {
    try {
        const servicos = await apiGet('/servicos');
        const select = document.getElementById('servico');
        select.innerHTML = '<option value="">Selecione...</option>';
        servicos.forEach(s => {
            const option = document.createElement('option');
            option.value = JSON.stringify({ nome: s.nome, preco: s.preco });
            option.textContent = `${s.nome} - R$ ${formatMoney(s.preco)}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Erro ao carregar serviços:', error);
    }
}

async function atualizarHorarios(horaAtual = null) {
    const data = document.getElementById('data').value;
    const selectHora = document.getElementById('hora');
    if (!data) return;

    try {
        if (todosAgendamentos.length === 0) {
            todosAgendamentos = await apiGet('/agendamentos');
        }

        const ocupados = todosAgendamentos.filter(o =>
            o.data === data &&
            o.status !== 'cancelado' &&
            o.id != editId
        );

        const todosHorarios = gerarHorarios();
        selectHora.innerHTML = '<option value="">Selecione...</option>';

        todosHorarios.forEach(horario => {
            const ocupado = ocupados.some(o => o.hora === horario);
            if (!ocupado || horario === horaAtual) {
                const option = document.createElement('option');
                option.value = horario;
                option.textContent = horario;
                if (horario === horaAtual) option.selected = true;
                selectHora.appendChild(option);
            }
        });
    } catch (error) {
        console.error('Erro ao atualizar horários:', error);
    }
}

async function carregarAgendamento() {
    if (!isEdicao) return;

    document.getElementById('titulo').textContent = 'Editar Agendamento';
    document.getElementById('btnSalvar').textContent = '💾 Salvar Alterações';
    document.getElementById('statusGroup').style.display = 'block';
    document.getElementById('btnCancelarAg').style.display = 'block';

    try {
        const agendamentos = await apiGet('/agendamentos');
        const ag = agendamentos.find(a => a.id == editId);

        if (!ag) {
            alert('Agendamento não encontrado');
            window.location.href = 'agendamentos.html';
            return;
        }

        document.getElementById('agendamentoId').value = ag.id;
        document.getElementById('nome').value = ag.nome;
        document.getElementById('telefone').value = ag.telefone;
        document.getElementById('data').value = ag.data;
        document.getElementById('status').value = ag.status;

        await carregarServicos();
        const servicoSelect = document.getElementById('servico');
        Array.from(servicoSelect.options).forEach(opt => {
            if (opt.value) {
                const s = JSON.parse(opt.value);
                if (s.nome === ag.servico && s.preco == ag.preco) {
                    opt.selected = true;
                }
            }
        });

        await atualizarHorarios(ag.hora);
    } catch (error) {
        alert('Erro ao carregar agendamento: ' + error.message);
    }
}

async function cancelarAgendamento() {
    if (!confirm('Tem certeza que quer cancelar esse agendamento?')) return;

    try {
        await apiPost(`/agendamentos/${editId}/cancelar`, {});
        alert('Agendamento cancelado!');
        window.location.href = 'agendamentos.html';
    } catch (error) {
        alert('Erro ao cancelar: ' + error.message);
    }
}

function voltarPagina() {
    const origem = urlParams.get('from');
    if (origem === 'dashboard') {
        window.location.href = 'dashboard-barbearia.html';
    } else {
        window.location.href = 'agendamentos.html';
    }
}

document.getElementById('agendaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgDiv = document.getElementById('mensagem');

    try {
        const servico = JSON.parse(document.getElementById('servico').value);
        const dados = {
            nome: document.getElementById('nome').value,
            telefone: document.getElementById('telefone').value,
            servico: servico.nome,
            preco: servico.preco,
            data: document.getElementById('data').value,
            hora: document.getElementById('hora').value
        };

        if (isEdicao) {
            dados.status = document.getElementById('status').value;
        }

        let resultado;
        if (isEdicao) {
            resultado = await apiPut(`/agendamentos/${editId}`, dados);
        } else {
            resultado = await apiPost('/agendamentos', dados);
        }

        msgDiv.innerHTML = `<div class="mensagem sucesso">${resultado.mensagem}</div>`;
        setTimeout(() => window.location.href = 'agendamentos.html', 1500);

    } catch (error) {
        msgDiv.innerHTML = `<div class="mensagem erro">${error.message}</div>`;
        await atualizarHorarios();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const auth = getAuth();
    if (!auth) {
        window.location.href = 'login-barbearia.html';
        return;
    }

    document.getElementById('userName').textContent = auth.nome || 'Admin';
    document.getElementById('userEmail').textContent = auth.email;
    document.getElementById('userAvatar').textContent = (auth.nome || 'A')[0].toUpperCase();
    document.getElementById('nomeEstabelecimento').textContent = auth.nome || 'Sua Barbearia';

    document.getElementById('data').addEventListener('change', () => atualizarHorarios());
    document.getElementById('data').min = new Date().toISOString().split('T')[0];
    document.getElementById('btnCancelarAg').addEventListener('click', cancelarAgendamento);

    await carregarServicos();

    if (isEdicao) {
        await carregarAgendamento();
    } else {
        await atualizarHorarios();
    }
});