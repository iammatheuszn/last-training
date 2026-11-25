# Last Training — produção

Três valores vêm de fora: domínio HTTPS, certificado/TLS e identidade de assinatura. Todo o resto já está no repositório.

## 1. Ambiente

```powershell
Copy-Item .env.example .env
```

Edite `.env`:

```dotenv
LT_ENV=production
LT_SERVER_HOST=127.0.0.1
LT_SERVER_PORT=8787
LT_PUBLIC_ORIGIN=https://app.seu-dominio.com
LT_AUTH_API_BASE_URL=https://app.seu-dominio.com
LT_DB_PATH=C:/last-training/server/data/last-training.db
AUTH_JWT_SECRET=<64+ caracteres aleatórios>
LT_TLS_TERMINATED=true
LT_TRUST_PROXY=true
LT_TRUSTED_PROXIES=127.0.0.1,::1
LT_UPDATE_URL=https://updates.seu-dominio.com
LT_UPDATE_PUBLIC_KEY=<chave pública Ed25519 em PEM>
```

Em produção o servidor recusa secret efêmero, origem HTTP, banco sem caminho explícito e TLS ausente. Se o proxy encerrar HTTPS, use `LT_TLS_TERMINATED=true`. Se o Node encerrar HTTPS direto, use `LT_TLS_KEY` e `LT_TLS_CERT` com caminhos reais.

## 2. Proxy HTTPS

Modelos prontos:

- `deploy/Caddyfile` — Caddy com `{$LT_PUBLIC_ORIGIN}` e `{$LT_SERVER_PORT}`
- `deploy/nginx.conf` — nginx com redirect 80→443, TLS 1.2/1.3 e `client_max_body_size 32k`

O backend continua escutando apenas `127.0.0.1:8787`. O proxy entrega `X-Forwarded-For`; o servidor só confia nesse header quando `LT_TRUST_PROXY=true` e o IP do proxy está em `LT_TRUSTED_PROXIES`.

## 3. Build e preflight

```powershell
npm ci
npm run build
npm run preflight -- --production
```

O preflight valida ambiente, runtime, integridade do bundle, painel admin, banco, TLS, chave de update, diretório de backup e, se houver origem pública, o `/health` real. Ele imprime apenas valores mascarados.

Subir a API:

```powershell
node server/index.js
```

O `/health` reporta `quick_check` do SQLite, contagem de contas/dispositivos/sessões, licenças ativas, último evento de auditoria, estado do segredo JWT e TLS. Resposta `503` significa banco ou serviço degradado.

Smoke test completo, sem tocar no banco real:

```powershell
npm run smoke:production
```

O teste gera certificado e par Ed25519 temporários, assina um instalador fictício, sobe API e feed em HTTPS no loopback, cria conta isolada, executa login real, verifica `/health`, `/admin`, `latest.json`, SHA-512 do download e `preflight --production`, depois apaga tudo. É a prova local do caminho inteiro antes de usar domínio, certificado e chave de assinatura reais.

## 4. Backup e restore

```powershell
npm run backup:create -- --label diario
npm run backup:list
npm run backup:verify
npm run backup:restore -- --force
```

O backup faz `wal_checkpoint(TRUNCATE)`, `integrity_check`, copia o banco consolidado e grava `manifest.json` com SHA-256. `LT_BACKUP_RETENTION` controla quantas cópias ficam (padrão 7). Antes de restaurar sem `--force`, o script cria um backup `pre-restore`. Pare o servidor antes de restaurar.

## 5. Auditoria centralizada

```powershell
npm run audit:export -- --format jsonl --since 2026-01-01T00:00:00Z --out C:/logs/last-training/audit.jsonl
npm run audit:export -- --format csv --event login_failed --out C:/logs/last-training/falhas.csv
```

O export lê somente a tabela `audit` do banco do servidor. Não grava senha, token, bearer ou segredo JWT. Envie o arquivo para o coletor da sua infraestrutura; não existe dependência de serviço externo no projeto.

## 6. Updates assinados

Gerar chave uma vez, fora do repositório:

```powershell
openssl genpkey -algorithm ed25519 -out C:/last-training/keys/update.key
openssl pkey -in C:/last-training/keys/update.key -pubout -out C:/last-training/keys/update.pub
```

Assinar o instalador publicado:

```powershell
$env:LT_UPDATE_URL="https://updates.seu-dominio.com"
node scripts/sign-update.mjs --version 1.2.3 --dir release --key-path C:/last-training/keys/update.key --base https://updates.seu-dominio.com "Last Training Setup 1.2.3.exe"
```

O comando gera `release/latest.json` assinado com Ed25519 e `release/latest.yml` para o `electron-updater`. Publique os dois junto com o instalador. O cliente só habilita updates com `LT_UPDATE_URL` HTTPS e `LT_UPDATE_PUBLIC_KEY`; ele busca `latest.json`, verifica assinatura, URLs HTTPS, SHA-512 e tamanho antes de permitir download ou instalação. Chave privada nunca entra no executável.

## 7. Installer e assinatura de código

O release pipeline usa `electron-builder` com saída em `release/`, separada do `dist/` do Vite. Antes do empacotamento, `scripts/prepare-win-code-sign.js` semeia o cache `winCodeSign-2.6.0` sem os dois symlinks do Darwin que quebram extração em máquinas sem privilégio de symlink:

```powershell
$env:WIN_CSC_LINK="C:/last-training/certs/code-signing.pfx"
$env:WIN_CSC_KEY_PASSWORD="<senha do certificado>"
$env:LT_PUBLISHER_NAME="CN=Seu Publisher, O=Sua Empresa, C=BR"
$env:LT_UPDATE_URL="https://updates.seu-dominio.com"
$env:LT_UPDATE_PRIVATE_KEY_PATH="C:/last-training/keys/update.key"

npm run dist -- --clean
```

`npm run dist` falha se o certificado não estiver disponível. Ele roda ícone, build, `electron-builder --win --x64` com `forceCodeSigning=true`, valida o `Authenticode` via `Get-AuthenticodeSignature`, assina `latest.json` com Ed25519 e confere o SHA-512 do instalador. `LT_PUBLISHER_NAME` deve ser exatamente o subject do certificado; sem ele o electron-builder usa o CN do PFX.

Depois do release, gere o pacote de deploy:

```powershell
npm run bundle -- --api-base=https://app.seu-dominio.com --update-base=https://updates.seu-dominio.com
```

O bundle sai em `release/bundle/` com `updates/` (instalador, `latest.json`, `latest.yml`, chave pública), `config/runtime.json`, `server/` (proxy, `.env.example` e guia), `README.txt` e `manifest.json` com SHA-256 e tamanho de todo arquivo. O script verifica assinatura Ed25519, SHA-512 e tamanho do instalador, `latest.yml`, URLs HTTPS e varre o pacote contra `.env`, PFX, `.key` e chave privada PEM. Publique só o conteúdo de `updates/` no host HTTPS de atualizações; o `.env` e a chave privada ficam fora do pacote.

Para gerar installer sem certificado, use:

```powershell
npm run dist:unsigned -- --clean
```

Esse modo ainda assina o feed se `LT_UPDATE_PRIVATE_KEY_PATH` e `LT_UPDATE_URL` estiverem presentes, mas reporta o certificado como valor pendente. Nenhum `.pfx`, senha ou chave privada entra no repositório.

## 8. Ensaio local de assinatura

Sem certificado real, o caminho completo pode ser ensaiado com um certificado self-signed descartável:

```powershell
npm run smoke:release
```

O comando gera um PFX `CodeSigningCert`, uma chave Ed25519 e um diretório temporário; executa `npm run dist` com `forceCodeSigning=true`; valida o Authenticode, o `latest.json` assinado, o SHA-512, o tamanho, as URLs HTTPS e o `latest.yml`; remove o certificado do store e apaga tudo no final. O relatório aceita `UnknownError` no Authenticode apenas nesse modo, porque a raiz do certificado temporário não é confiável. Nada disso substitui o certificado real: `npm run dist` sem a flag de ensaio exige status `Valid`.

## 9. Operação

- O painel fica em `https://app.seu-dominio.com/admin`; nenhuma credencial admin existe no Electron.
- Tokens de acesso expiram em `LT_ACCESS_TTL`; refresh gira a cada renovação e revoga a família em replay.
- Logs de auditoria ficam no banco; exporte para o coletor com `audit:export`.
- Rodar `npm run preflight -- --production --url=https://app.seu-dominio.com` após cada deploy.
- `npm run smoke:bundle` repete o empacotamento com release, chave e domínios temporários e confere o manifesto final.
- `npm run acceptance` é o portão local completo: testes, build, preflight, smoke HTTPS, smoke de release assinada, smoke de instalação silenciosa, smoke de restore (DR), smoke de abuse/load e smoke de bundle.
