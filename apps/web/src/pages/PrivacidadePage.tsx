import { Link } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";

/**
 * Política de privacidade pública (exigida pela App Store e pelo Google Play).
 * Fonte dos dados coletados: docs/app-lojas.md — mudou lá, muda aqui.
 */
const EMPRESA = {
  razao: "Pinheiro Lucena Tecnologia Ltda.",
  fantasia: "ISPhub",
  cnpj: "52.152.454/0001-81",
  endereco: "Rua Nossa Senhora da Conceição, 99, Centro, Macaíba/RN, CEP 59280-190",
  telefone: "(84) 9218-7562",
};

const DADOS: [string, string][] = [
  ["Nome, e-mail e telefone do profissional", "Criar e manter a conta e permitir o contato da equipe."],
  ["Localização precisa, só com o app em uso", "Conferir cobertura no endereço do cliente, montar a rota do dia e registrar a chegada na ordem de serviço. É opcional: dá para informar o endereço pelo CEP."],
  ["Fotos", "Evidência da ordem de serviço, foto do perfil e anexos do chat. Opcional."],
  ["Áudio", "Mensagens de voz no chat interno. Opcional."],
  ["Conteúdo de mensagens", "Chat interno da equipe e conversa com o cliente pelo WhatsApp oficial do provedor."],
  ["Dados de clientes do provedor (nome, CPF, endereço, telefone)", "Pré-cadastro, agendamento e atendimento, enviados ao sistema de gestão do próprio provedor."],
  ["Identificador do aparelho para notificações", "Avisar sobre novas ordens de serviço e mensagens. Opcional."],
];

export function PrivacidadePage() {
  return (
    <main className="min-h-dvh bg-background px-4 py-10">
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 text-sm leading-relaxed text-muted-foreground">
        <div className="flex justify-center">
          <BrandMark />
        </div>

        <header className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Política de privacidade</h1>
          <p>ISPhub — atualizada em 1º de novembro de 2026.</p>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Quem somos</h2>
          <p>
            O ISPhub (aplicativo e painel) é operado por {EMPRESA.razao} ({EMPRESA.fantasia}), CNPJ {EMPRESA.cnpj},{" "}
            {EMPRESA.endereco}. É uma ferramenta de trabalho para provedores de internet: as contas são criadas pela
            empresa contratante, não há cadastro aberto ao público.
          </p>
          <p>
            Para os dados dos profissionais que usam o ISPhub, somos os controladores. Para os dados dos clientes de
            cada provedor, o controlador é o próprio provedor; o ISPhub trata esses dados em nome dele, só para as
            finalidades abaixo.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Que dados tratamos e para quê</h2>
          <ul className="flex flex-col gap-3">
            {DADOS.map(([dado, uso]) => (
              <li key={dado} className="rounded-lg border border-border bg-card p-3">
                <p className="font-medium text-foreground">{dado}</p>
                <p>{uso}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">O que não fazemos</h2>
          <p>
            Não vendemos dados, não usamos dados para publicidade e não rastreamos você em outros apps ou sites. Os
            dados só são compartilhados com o provedor para o qual você trabalha e com os serviços necessários para o
            funcionamento (hospedagem, envio de notificações e WhatsApp oficial do provedor).
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Segurança e retenção</h2>
          <p>
            Os dados trafegam criptografados (HTTPS) e o acesso é limitado pelo papel de cada usuário. Guardamos os
            dados enquanto a conta estiver ativa ou enquanto o provedor contratante precisar deles para cumprir
            obrigações legais.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Seus direitos</h2>
          <p>
            Pela LGPD (Lei 13.709/2018), você pode pedir acesso, correção, portabilidade ou exclusão dos seus dados e
            revogar consentimentos. Fale com o administrador do seu provedor ou diretamente conosco pelo telefone{" "}
            {EMPRESA.telefone}. Se a conta for desativada, você pode pedir a exclusão dos dados pelo mesmo canal.
          </p>
        </section>

        <p className="pt-4 text-center">
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Ir para o login
          </Link>
        </p>
      </article>
    </main>
  );
}
