// /public/js/core/auth.js
let barbearia = JSON.parse(localStorage.getItem('barbearia'));

function checkAuth() {
    if (!barbearia) {
        window.location.href = '/login-barbearia.html';
        return false;
    }
    return true;
}

function getAuth() {
    return barbearia;
}

function logout() {
    localStorage.removeItem('barbearia');
    window.location.href = '/login-barbearia.html';
}

function updateUserInfo() {
    if (!checkAuth()) return;
    document.getElementById('userName').textContent = barbearia.nome || 'Admin';
    document.getElementById('userEmail').textContent = barbearia.email;
    document.getElementById('userAvatar').textContent = (barbearia.nome || 'A')[0].toUpperCase();
    document.getElementById('nomeEstabelecimento').textContent = barbearia.nome || 'Sua Barbearia';
}

checkAuth();