// /public/js/pages/dashboard.js
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

function mostrarAgenda() {
    window.location.href = 'agendamentos.html';
}

function editarAgendamento(id) {
    window.location.href = `agendamento.html?id=${id}&from=dashboard`;
}

async function carregarDashboard() {
    const hoje = new Date();
    const inicioSemana = new Date(hoje);
    inicioSemana.setDate(hoje.getDate() - hoje.getDay() + 1);

    const headerEl = document.getElementById('calendarHeader');
    headerEl.innerHTML = '<div class="calendar-header-cell"></div>';

    for (let i = 0; i < 7; i++) {
        const dia = new Date(inicioSemana);
        dia.setDate(inicioSemana.getDate() + i);
        const isHoje = dia.toDateString() === hoje.toDateString();

        headerEl.innerHTML += `
            <div class="calendar-header-cell">
                <div class="day-name">${['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'][dia.getDay()]}</div>
                <div class="day-number ${isHoje ? 'today' : ''}">${dia.getDate()}</div>
            </div>
        `;
    }

    const timeCol = document.getElementById('timeColumn');
    timeCol.innerHTML = '';
    for (let h = 8; h <= 20; h++) {
        timeCol.innerHTML += `<div class="time-slot">${h}:00</div>`;
    }

    const bodyEl = document.getElementById('calendarBody');
    bodyEl.innerHTML = timeCol.outerHTML;

    const agendamentos = await apiGet('/agendamentos');

    for (let i = 0; i < 7; i++) {
        const dia = new Date(inicioSemana);
        dia.setDate(inicioSemana.getDate() + i);
        const diaStr = dia.toISOString().split('T')[0];
        const agsDoDia = agendamentos.filter(a => a.data === diaStr);

        let dayCol = '<div class="day-column"><div class="day-grid">';

        for (let h = 8; h <= 20; h++) {
            dayCol += '<div class="hour-line"></div>';
        }

        agsDoDia.forEach(ag => {
            const [hora, min] = ag.hora.split(':').map(Number);
            const top = (hora - 8) * 60 + min;
            const duracao = 45;
            const colors = ['blue', 'green', 'pink', 'purple'];
            const color = colors[Math.floor(Math.random() * colors.length)];

            dayCol += `
                <div class="appointment-card ${color}" style="top: ${top}px; height: ${duracao}px;" onclick="editarAgendamento(${ag.id})">
                    <div class="apt-price">R$ ${ag.preco}</div>
                    <div class="apt-time">${ag.hora}</div>
                    <div class="apt-name">${ag.nome}</div>
                    <div class="apt-service">${ag.servico}</div>
                </div>
            `;
        });

        dayCol += '</div></div>';
        bodyEl.innerHTML += dayCol;
    }

    const hojeStr = hoje.toISOString().split('T')[0];
    const agsHoje = agendamentos.filter(a => a.data === hojeStr);
    const mesStr = `${hoje.getFullYear()}-${(hoje.getMonth() + 1).toString().padStart(2, '0')}`;
    const agsMes = agendamentos.filter(a => a.data.startsWith(mesStr));

    document.getElementById('agendamentosHoje').textContent = agsHoje.length;
    document.getElementById('agendamentosSub').textContent = `${agsMes.length} no mês`;

    const fatHoje = agsHoje.reduce((s, a) => s + (a.preco || 0), 0);
    document.getElementById('faturamentoHoje').textContent = `R$ ${formatMoney(fatHoje)}`;

    const clientesUnicos = new Set(agsMes.map(a => a.nome)).size;
    document.getElementById('clientesMes').textContent = clientesUnicos;

    const ticket = agsMes.length > 0 ? agsMes.reduce((s, a) => s + (a.preco || 0), 0) / agsMes.length : 0;
    document.getElementById('ticketMedio').textContent = `R$ ${formatMoney(ticket)}`;
}

// Inicializa
carregarDashboard();