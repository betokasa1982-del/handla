# Ligar o assistente de IA

A lista e a voz funcionam sem isto. O modelo só entra se você quiser frases mais soltas, do tipo “acabou o leite e preciso de coisas pra lasanha”. A chave da API fica neste worker, nunca no celular.

## O que você precisa

Uma conta com um modelo que fale o formato da OpenAI (chat completions com tools). O padrão barato é o **gpt-4o-mini** da OpenAI.

- Conta: https://platform.openai.com/
- Crie uma chave em API keys.
- Uso pessoal (umas poucas conversas por dia) fica em geral **abaixo de 1 dólar por mês**. Uma conversa curta com ferramentas custa frações de centavo. O teto do worker é 400 tokens de resposta e 40 chamadas por aparelho a cada hora.

Se preferir a xAI (Grok), use a base `https://api.x.ai/v1` e o modelo que a sua conta mostrar, por exemplo `grok-2-latest`. A chave é a da xAI, não a da OpenAI.

## Publicar o worker

Na pasta `server`, com o [Wrangler](https://developers.cloudflare.com/workers/wrangler/) e uma conta gratuita da Cloudflare:

```bash
cd server
npx wrangler login
npx wrangler secret put LLM_API_KEY
npx wrangler secret put APP_TOKEN
npx wrangler deploy
```

`APP_TOKEN` é uma senha curta que você inventa (pode ser uma frase). Ela não é a chave do modelo. Quem não a enviar recebe 401.

O deploy imprime um endereço `https://handla-ai.<sua-conta>.workers.dev`.

Abra `https://handla-ai.<sua-conta>.workers.dev/health`. Tem que responder `{"ok":true,...}`.

## No celular

1. Abra o Handla → **Ajustes**.
2. Em **Assistente IA**, cole o endereço do worker.
3. Cole o mesmo `APP_TOKEN`.
4. Toque em **Testar ligação**. O estado deve passar para **IA**.
5. Deixe **Falar as respostas** ligado se quiser ouvir a resposta.

O botão redondo do microfone fica na lista. No Chrome do Android, instalado na tela inicial, ele usa o reconhecimento de voz do celular. Se o aparelho não tiver voz, abre uma caixa de texto.

Sem endereço, ou se o worker falhar, o app diz **No telefone** e ainda entende frases curtas: “dois litros de leite e pão Hönö”, “tira os ovos”, “onde compro mais barato?”, “quanto vou gastar?”, “tem oferta de café?”.
