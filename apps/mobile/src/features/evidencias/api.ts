import type { EvidenciaResumo } from "@isphub/shared";
import { apiFetch, baixarAnexoAutenticado } from "@/lib/api";
import type { EvidenciaInput } from "./limites";

export async function listarEvidencias(osId: string, token: string | null): Promise<EvidenciaResumo[]> {
  return apiFetch<EvidenciaResumo[]>(`/ordens-servico/${osId}/evidencias`, { token });
}

export async function enviarEvidencia(osId: string, token: string | null, corpo: EvidenciaInput): Promise<EvidenciaResumo[]> {
  return apiFetch<EvidenciaResumo[]>(`/ordens-servico/${osId}/evidencias`, {
    method: "POST",
    token,
    body: corpo,
  });
}

/**
 * A listagem devolve EvidenciaResumo sem URL de miniatura, entao nao da pra
 * alimentar <Image source={{uri}}> direto dela — cada foto exige baixar o
 * arquivo com o JWT, mesmo padrao do useAvatarUri.
 */
export function caminhoArquivoEvidencia(osId: string, anexoId: string): string {
  return `/ordens-servico/${osId}/evidencias/${anexoId}/arquivo`;
}

export async function baixarEvidencia(osId: string, anexoId: string, token: string | null): Promise<string> {
  return baixarAnexoAutenticado(caminhoArquivoEvidencia(osId, anexoId), token);
}
