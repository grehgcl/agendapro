// /public/js/pages/clientes.js
let clientes = [];
let clienteEditandoId = null;

function getAuth() {
    return JSON.parse(localStorage.getItem('barbearia'));
}

async function fetchAPI(endpoint, options = {}) {
    const auth = getAuth();
    const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';

    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'barbearia-id': auth.id,
            'Authorization': auth.token
        }
    };

    const response = await fetch(`${API_URL}${endpoint}`, {
        ...defaultOptions,
        ...options,
        headers: { ...defaultOptions.headers, ...options.headers }
    });

    if (response.status === 403) {
        alert('Sessão expirada! Faça login novamente.');
        window.location.href = 'login-barbearia.html';
    }

    return response;
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('show');
    document.querySelector('.sidebar-overlay').classList.toggle('show');
}

function logout() {
    localStorage.removeItem('barbearia');
    window.location.href = '/login-barbearia.html';
}

async function carregarClientes() {
    try {
        const response = await fetchAPI('/clientes');
        clientes = await response.json();
        exibirClientes(clientes);
        document.getElementById('totalClientes').textContent = clientes.length;
    } catch (error) {
        console.error('Erro:', error);
        document.getElementById('listaClientes').innerHTML = `
            <tr><td colspan="4" style="text-align: center; color: #ef4444;">❌ Erro ao carregar clientes</td></tr>
        `;
    }
}

function exibirClientes(clientesFiltrados) {
    const container = document.getElementById('listaClientes');

    if (!clientesFiltrados || clientesFiltrados.length === 0) {
        container.innerHTML = `
            <tr><td colspan="4" style="text-align: center; color: #9ca3af; padding: 40px;">
                📭 Nenhum cliente cadastrado ainda
            </td></tr>
        `;
        return;
    }

    container.innerHTML = clientesFiltrados.map(cliente => `
        <tr>
            <td><strong>${escapeHtml(cliente.nome)}</strong></td>
            <td>${escapeHtml(cliente.email)}</td>
            <td>${escapeHtml(cliente.telefone) || 'Não informado'}</td>
            <td>
                <button class="btn btn-edit" data-id="${cliente.id}">✏️</button>
                <button class="btn btn-delete" data-id="${cliente.id}" data-nome="${escapeHtml(cliente.nome)}">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function abrirModal(id = null) {
    clienteEditandoId = id;

    if (id) {
        const cliente = clientes.find(c => c.id === id);
        document.getElementById('modalTitle').textContent = '✏️ Editar Cliente';
        document.getElementById('clienteNome').value = cliente.nome;
        document.getElementById('clienteEmail').value = cliente.email;
        document.getElementById('clienteTelefone').value = cliente.telefone || '';
    } else {
        document.getElementById('modalTitle').textContent = '➕ Novo Cliente';
        document.getElementById('clienteNome').value = '';
        document.getElementById('clienteEmail').value = '';
        document.getElementById('clienteTelefone').value = '';
    }

    document.getElementById('modalCliente').classList.add('show');
}

function fecharModal() {
    document.getElementById('modalCliente').classList.remove('show');
    clienteEditandoId = null;
}

async function salvarCliente() {
    const nome = document.getElementById('clienteNome').value.trim();
    const email = document.getElementById('clienteEmail').value.trim();
    const telefone = document.getElementById('clienteTelefone').value.trim();

    if (!nome || !email) {
        mostrarToast('Preencha nome e e-mail!', true);
        return;
    }

    const dados = { nome, email, telefone };

    try {
        let response;
        if (clienteEditandoId) {
            response = await fetchAPI(`/clientes/${clienteEditandoId}`, {
                method: 'PUT',
                body: JSON.stringify(dados)
            });
        } else {
            response = await fetchAPI('/clientes', {
                method: 'POST',
                body: JSON.stringify(dados)
            });
        }

        const resultado = await response.json();

        if (response.ok) {
            mostrarToast(clienteEditandoId ? '✅ Cliente atualizado!' : '✅ Cliente cadastrado!');
            fecharModal();
            carregarClientes();
        } else {
            mostrarToast(resultado.erro || 'Erro ao salvar', true);
        }
    } catch (error) {
        mostrarToast('Erro ao conectar com o servidor', true);
    }
}

async function excluirCliente(id, nome) {
    if (confirm(`Tem certeza que deseja excluir "${nome}"?\n\nEssa ação não pode ser desfeita.`)) {
        try {
            const response = await fetchAPI(`/clientes/${id}`, {
                method: 'DELETE'
            });

            const resultado = await response.json();

            if (response.ok) {
                mostrarToast('✅ Cliente excluído!');
                carregarClientes();
            } else {
                mostrarToast(resultado.erro || 'Erro ao excluir', true);
            }
        } catch (error) {
            mostrarToast('Erro ao conectar com o servidor', true);
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

// TUDO QUE PRECISA DO DOM VAI AQUI DENTRO
document.addEventListener('DOMContentLoaded', () => {
    const auth = getAuth(); // Usa a função do auth.js

    if (!auth) {
        window.location.href = 'login-barbearia.html';
        return;
    }

    // Preenche dados do usuário
    document.getElementById('userNome').textContent = auth.nome || 'Admin';
    document.getElementById('userEmail').textContent = auth.email;
    document.getElementById('userAvatar').textContent = (auth.nome || 'A')[0].toUpperCase();
    document.getElementById('nomeEstabelecimento').textContent = auth.nome || 'Sua Barbearia';

    // Event Listeners
    document.getElementById('btnNovoCliente').addEventListener('click', () => abrirModal());

    document.getElementById('searchInput').addEventListener('input', (e) => {
        const termo = e.target.value.toLowerCase();
        const filtrados = clientes.filter(cliente =>
            cliente.nome.toLowerCase().includes(termo) ||
            cliente.email.toLowerCase().includes(termo) ||
            (cliente.telefone && cliente.telefone.includes(termo))
        );
        exibirClientes(filtrados);
        document.getElementById('totalClientes').textContent = filtrados.length;
    });

    document.getElementById('modalCliente').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modalCliente')) {
            fecharModal();
        }
    });

    // Delegation pros botões da tabela
    document.getElementById('listaClientes').addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-edit')) {
            const id = parseInt(e.target.dataset.id);
            abrirModal(id);
        }
        if (e.target.classList.contains('btn-delete')) {
            const id = parseInt(e.target.dataset.id);
            const nome = e.target.dataset.nome;
            excluirCliente(id, nome);
        }
    });

    // Carrega os dados
    carregarClientes();
});