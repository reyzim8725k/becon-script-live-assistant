# Assistente do Becon Script

Assistente automatizado para lives do TikTok. O projeto monitora comentários, presentes, entradas e curtidas de uma live, reproduz respostas curtas em áudio e envia notificações de presentes para um bot do Telegram. A interface web exibe a atividade em tempo real e permite testar as falas.

O sistema não usa inteligência artificial. As respostas são mensagens prontas, o que reduz a latência e evita custos por requisição.

## Recursos

| Evento | Ação |
|---|---|
| Comentário contendo “script”, “scripts”, “código” ou “script VIP” | Reproduz uma mensagem informando que os scripts grátis estão no link da bio. A mesma pessoa recebe essa resposta no máximo uma vez a cada 30 segundos. |
| Presente | Gera um MP3 personalizado com o nome do usuário e o nome do presente, reproduz a mensagem sobre a entrega do script ao final da live e envia uma notificação para o Telegram. |
| Entrada na live | Gera e reproduz uma saudação curta com o nome do usuário. |
| Curtida | Reproduz uma mensagem apenas na primeira curtida observada de cada usuário durante a execução atual. |

Os áudios são gerados com `gtts-cli` e reproduzidos pelo `mpv`. Os MP3 temporários são excluídos depois da reprodução e também são removidos na inicialização do servidor.

## Requisitos

O projeto foi feito para Termux em Android. Instale o Termux pela mesma fonte do Termux:API quando a API do Termux for utilizada em outros projetos; este projeto usa `mpv` e `gTTS` diretamente para o áudio.

São necessários:

| Componente | Finalidade |
|---|---|
| Node.js | Executar o servidor |
| Python e gTTS | Gerar MP3 a partir do texto |
| mpv | Reproduzir os MP3 |
| Internet | Receber eventos da live e gerar os áudios pelo Google TTS |
| Token de bot e Chat ID | Enviar notificações ao Telegram |

## Instalação no Termux

Atualize os pacotes e instale os programas do sistema:

```bash
pkg update
pkg upgrade -y
pkg install nodejs python mpv -y
```

Instale o gTTS:

```bash
pip install gTTS
```

Confirme as instalações:

```bash
node --version
python --version
gtts-cli --help
mpv --version
```

Instale as dependências Node.js na pasta do projeto:

```bash
cd ~/becon-script-assistant
npm install
```

## Instalação pelo GitHub

Clone o repositório:

```bash
git clone URL_DO_REPOSITORIO ~/becon-script-assistant
cd ~/becon-script-assistant
npm install
```

Substitua `URL_DO_REPOSITORIO` pela URL do repositório depois que ele for criado.

## Executar

Inicie o servidor:

```bash
cd ~/becon-script-assistant
node server.js
```

O terminal solicitará os dados nesta ordem:

```text
Digite o nome de usuário da live:
Cole o token do bot Telegram:
Digite o Chat ID do Telegram:
```

Digite o usuário sem ou com `@`. O programa remove o `@` automaticamente.

Depois abra o painel no navegador:

```text
http://localhost:3000
```

O site mostra comentários e eventos, oferece testes de voz e permite ajustar as falas que serão enviadas ao servidor. A voz principal é gerada e reproduzida no Termux, portanto o site não precisa permanecer em primeiro plano para o áudio.

## Notificação do Telegram

Quando um presente é recebido, o bot envia uma mensagem no formato:

```text
NOVO PRESENTE 🎁
TIPO: Rose
QUANTIDADE: 1x
HORÁRIO: 11/09/2026, 14:10:20
USUÁRIO: @exemplo
```

O bot precisa ter sido iniciado pelo usuário do Telegram e o Chat ID deve corresponder à conversa de destino. Para um grupo, use o Chat ID do grupo.

### Segurança do token

Nunca publique o token do bot no GitHub. O servidor solicita o token no terminal e não o salva no repositório. Se um token for exposto, revogue-o no BotFather e gere outro.

## Configuração de áudio

O padrão usa quatro workers para gerar MP3 em paralelo:

```bash
AUDIO_WORKERS=4 node server.js
```

Para aumentar o número de tarefas simultâneas:

```bash
AUDIO_WORKERS=8 node server.js
```

A geração é paralela, mas a reprodução é enfileirada para evitar que várias falas sejam misturadas. A velocidade de reprodução está configurada no `mpv` em `1.15x`, com correção de pitch.

## Estrutura

```text
.
├── package.json
├── server.js
├── public/
│   └── index.html
└── README.md
```

A pasta `audios/` é criada automaticamente. Seus MP3 temporários não são versionados pelo Git.

## Solução de problemas

### O servidor não inicia

Verifique a versão do Node.js e instale as dependências:

```bash
node --version
npm install
```

### A live conecta, mas não chegam eventos

Confirme que o usuário digitado é exatamente o usuário que está ao vivo. O servidor precisa ser iniciado antes dos eventos que você deseja testar.

### O MP3 não é gerado

Teste manualmente:

```bash
gtts-cli "Teste de áudio" --lang pt --output teste.mp3
ls -lh teste.mp3
```

Se o arquivo for criado, teste a reprodução:

```bash
mpv teste.mp3
rm teste.mp3
```

### O áudio não toca

Confirme que o `mpv` está instalado e que o volume do Android está audível:

```bash
mpv --version
```

### O Telegram não recebe a mensagem

Confira o token, o Chat ID e a conexão com a internet. O terminal exibirá o código HTTP retornado pelo Telegram quando houver erro.

## Limitações

O TikTok Live Connector é uma biblioteca não oficial baseada na leitura dos eventos da live. Mudanças no protocolo do TikTok podem alterar o comportamento do projeto. A lista de usuários que já curtiram existe apenas na memória; ao reiniciar o servidor, ela é zerada.

Os nomes de usuários e presentes são inseridos no texto enviado ao gTTS. Como os eventos vêm de terceiros, o servidor limita e limpa o texto antes de gerar o áudio.

## Licença

Este projeto é distribuído para uso pessoal. Verifique as licenças das dependências antes de redistribuir ou oferecer o serviço a terceiros.

## Referências

[1]: https://github.com/zerodytrash/TikTok-Live-Connector "TikTok Live Connector"
[2]: https://gtts.readthedocs.io/ "gTTS documentation"
[3]: https://mpv.io/manual/stable/ "mpv manual"
[4]: https://core.telegram.org/bots/api "Telegram Bot API"
