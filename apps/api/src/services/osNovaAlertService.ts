/**
 * Texto do aviso de OS nova.
 *
 * Puro e separado do job porque e a unica parte com decisao: o resto e uma
 * consulta. O TIPO entra junto do nome porque "chegou uma OS" nao diz o que
 * fazer — quem despacha precisa saber se e instalacao (agenda equipe) ou
 * reparo (prioriza) antes de abrir a tela.
 */
export function mensagemOsNova(os: {
  clienteNome: string | null;
  sgpOsId: string;
  tipoDescricao: string | null;
}): string {
  // Sem nome do cliente cai no numero da OS — mesmo fallback do alerta de SLA,
  // pra que a notificacao nunca fique sem identificacao nenhuma.
  const quem = os.clienteNome?.trim() || `OS #${os.sgpOsId}`;
  const tipo = os.tipoDescricao?.trim();
  return tipo ? `Nova OS (${tipo}): ${quem}` : `Nova OS: ${quem}`;
}
