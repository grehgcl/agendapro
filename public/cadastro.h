<!DOCTYPE html>
<html lang="pt">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cadastro de Clientes - Barbearia Estilo</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }

        .header h1 {
            font-size: 2em;
            margin-bottom: 10px;
        }

        .content {
            padding: 30px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            color: #333;
        }

        input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }

        input:focus {
            outline: none;
            border-color: #f5576c;
        }

        button {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            width: 100%;
            transition: transform 0.2s;
        }

        button:hover {
            transform: translateY(-2px);
        }

        .btn-voltar {
            background: #6c757d;
            margin-top: 10px;
        }

        .mensagem {
            margin-top: 20px;
            padding: 15px;
            border-radius: 8px;
            display: none;
        }

        .sucesso {
            background-color: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
            display: block;
        }

        .erro {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            display: block;
        }

        .lista-clientes {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid #eee;
        }

        .lista-clientes h3 {
            margin-bottom: 15px;
            color: #333;
        }

        .cliente-item {
            background: #f8f9fa;
            padding: 15px;
            margin-bottom: 10px;
            border-radius: 8px;
            border-left: 4px solid #f5576c;
        }

        .cliente-nome {
            font-weight: bold;
            font-size: 1.1em;
            color: #333;
        }

        .cliente-info {
            color: #666;
            font-size: 0.9em;
            margin-top: 5px;
        }

        .loading {
            display: none;
            text-align: center;
            margin-top: 20px;
        }

        .loading.show {
            display: block;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #f5576c;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }

        @keyframes spin {
            0% {
                transform: rotate(0deg);
            }

            100% {
                transform: rotate(360deg);
            }
        }
    </style>
</head>

<body>
    <div class="container">
        <div class="header">
            <h1>📝 Cadastro de Clientes</h1>
            <p>Cadastre-se para receber ofertas exclusivas</p>
        </div>

        <div class="content">
            <form id="cadastroForm">
                <div class="form-group">
                    <label for="nome">Nome completo *</label>
                    <input type="text" id="nome" required placeholder="Digite seu nome completo">
                </div>

                <div class="form-group">
                    <label for="email">E-mail *</label>
                    <input type="email" id="email" required placeholder="seu@email.com">
                </div>

                <div class="form-group">
                    <label for="telefone">Telefone/WhatsApp *</label>
                    <input type="tel" id="telefone" required placeholder="(99) 99999-9999">
                </div>

                <button type="submit">✅ Cadastrar Cliente</button>
                <button type="button" class="btn-voltar" onclick="window.location.href='/'">🏠 Voltar ao Início</button>
            </form>

            <div id="mensagem" class="mensagem"></div>
            <div id="loading" class="loading">
                <div class="spinner"></div>
                <p>Cadastrando...</p>
            </div>

            <div class="lista-clientes">
                <h3>👥 Clientes Cadastrados</h3>
                <div id="listaClientes"></div>
            </div>
        </div>
    </div>

    <script>
        const API_URL = 'http://localhost:3000/api';

        // Carregar lista de clientes
        async function carregarClientes() {
            try {
                const response = await fetch(`${API_URL}/clientes`);
                const clientes = await response.json();

                const listaDiv = document.getElementById('listaClientes');

                if (clientes.length === 0) {
                    listaDiv.innerHTML = '<p style="text-align: center; color: #999;">Nenhum cliente cadastrado ainda</p>';
                    return;
                }

                listaDiv.innerHTML = clientes.map(cliente => `
                    <div class="cliente-item">
                        <div class="cliente-nome">${cliente.nome}</div>
                        <div class="cliente-info">
                            📧 ${cliente.email} | 📱 ${cliente.telefone || 'Não informado'}
                        </div>
                    </div>
                `).join('');
            } catch (error) {
                console.error('Erro ao carregar clientes:', error);
            }
        }

        // Cadastrar cliente
        document.getElementById('cadastroForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const dados = {
                nome: document.getElementById('nome').value,
                email: document.getElementById('email').value,
                telefone: document.getElementById('telefone').value
            };

            mostrarLoading(true);

            try {
                const response = await fetch(`${API_URL}/clientes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dados)
                });

                const resultado = await response.json();

                if (response.ok) {
                    mostrarMensagem(resultado.mensagem, 'sucesso');
                    document.getElementById('cadastroForm').reset();
                    carregarClientes(); // Recarregar lista
                } else {
                    mostrarMensagem(resultado.erro, 'erro');
                }
            } catch (error) {
                mostrarMensagem('Erro ao conectar com o servidor. Verifique se o servidor está rodando!', 'erro');
            } finally {
                mostrarLoading(false);
            }
        });

        function mostrarMensagem(msg, tipo) {
            const mensagemDiv = document.getElementById('mensagem');
            mensagemDiv.textContent = msg;
            mensagemDiv.className = `mensagem ${tipo}`;
            setTimeout(() => {
                mensagemDiv.className = 'mensagem';
            }, 5000);
        }

        function mostrarLoading(show) {
            const loading = document.getElementById('loading');
            if (show) {
                loading.classList.add('show');
            } else {
                loading.classList.remove('show');
            }
        }

        // Carregar clientes ao iniciar
        carregarClientes();
    </script>
</body>

</html>