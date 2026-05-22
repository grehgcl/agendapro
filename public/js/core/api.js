// /public/js/core/api.js

const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : window.location.origin;

function getHeaders() {
    const auth = getAuth();
    if (!auth) {
        logout();
        throw new Error('Não autenticado');
    }
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`,
        'barbearia-id': auth.id
    };
}

async function handleResponse(response) {
    if (response.status === 401) {
        alert('Sessão expirada! Faça login novamente.');
        logout();
        throw new Error('Unauthorized');
    }

    if (response.status === 204) {
        return null; // DELETE sem conteúdo
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || `Erro ${response.status}`);
    }

    return data;
}

async function apiGet(endpoint) {
    console.log('GET:', `${API_URL}/api${endpoint}`);
    const response = await fetch(`${API_URL}/api${endpoint}`, {
        method: 'GET',
        headers: getHeaders()
    });
    return handleResponse(response);
}

async function apiPost(endpoint, data) {
    console.log('POST:', `${API_URL}/api${endpoint}`, data);
    const response = await fetch(`${API_URL}/api${endpoint}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response);
}

async function apiPut(endpoint, data) {
    console.log('PUT:', `${API_URL}/api${endpoint}`, data);
    const response = await fetch(`${API_URL}/api${endpoint}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    return handleResponse(response);
}

async function apiDelete(endpoint) {
    console.log('DELETE:', `${API_URL}/api${endpoint}`);
    const response = await fetch(`${API_URL}/api${endpoint}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    return handleResponse(response);
}

function formatMoney(value) {
    if (!value && value !== 0) return '0,00';
    return Number(value).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}