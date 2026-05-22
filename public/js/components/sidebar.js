// /public/js/components/sidebar.js

function renderSidebar(activePage) {
    const auth = getAuth();

    const sidebarHTML = `
        <aside class="sidebar">
            <div class="logo-area">
                <h2>AgendaPro</h2>
                <p id="nomeEstabelecimento">${auth?.nome || 'Sua Barbearia'}</p>
            </div>
            
            <nav class="menu">
                <div class="menu-section">Principal</div>
                <a href="/dashboard-barbearia.html" class="menu-item ${activePage === 'dashboard' ? 'active' : ''}">
                    📊 Dashboard
                </a>
                <a href="/agendamentos.html" class="menu-item ${activePage === 'agenda' ? 'active' : ''}">
                    📅 Agenda
                </a>
                <a href="/servicos-barbearia.html" class="menu-item ${activePage === 'servicos' ? 'active' : ''}">
                    ✂️ Serviços
                </a>
                <a href="/clientes-barbearia.html" class="menu-item ${activePage === 'clientes' ? 'active' : ''}">
                    👥 Clientes
                </a>
                
                <div class="menu-section">Financeiro</div>
                <a href="/despesas-barbearia.html" class="menu-item ${activePage === 'financeiro' ? 'active' : ''}">
                    💰 Despesas
                </a>
            </nav>
            
            <div class="user-box">
                <div class="user-box-top">
                    <div class="user-avatar">${(auth?.nome || 'A')[0].toUpperCase()}</div>
                    <div class="user-info">
                        <h4>${auth?.nome || 'Admin'}</h4>
                        <p>${auth?.email || ''}</p>
                    </div>
                </div>
                <button class="btn-sair" onclick="logout()">Sair</button>
            </div>
        </aside>
    `;

    // MUDANÇA AQUI: insere antes do main-content
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.insertAdjacentHTML('beforebegin', sidebarHTML);
    } else {
        document.body.insertAdjacentHTML('afterbegin', sidebarHTML);
    }
}