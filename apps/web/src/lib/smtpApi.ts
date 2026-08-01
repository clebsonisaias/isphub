import type { SmtpConfigInput, SmtpConfigPublic } from "@isphub/shared";
import { api } from "@/lib/apiClient";

export const smtpApi = {
  obter: () => api.get<SmtpConfigPublic>("/admin/smtp"),
  salvar: (data: SmtpConfigInput) => api.put<SmtpConfigPublic>("/admin/smtp", data),
  /** Devolve 200 com `ok:false` quando o SMTP recusa — a mensagem e o diagnostico. */
  testar: (destinatario: string) => api.post<{ ok: boolean; mensagem: string }>("/admin/smtp/testar", { destinatario }),
  definirAtivo: (ativo: boolean) => api.patch<SmtpConfigPublic>("/admin/smtp/ativo", { ativo }),
};
