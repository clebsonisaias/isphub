import { describe, expect, it } from "vitest";
import { MensagemTipo } from "@isphub/shared";
import {
  estaOnline,
  resolverMencoes,
  resumoConteudo,
  validarMidia,
  whereMensagensNaoLidas,
  LIMITE_FOTO_BYTES,
  LIMITE_AUDIO_BYTES,
  LIMITE_AUDIO_SEG,
  type EnviarMensagemInput,
} from "./chatService.js";

describe("estaOnline", () => {
  it("null (nunca teve atividade registrada) -> offline", () => {
    expect(estaOnline(null)).toBe(false);
  });

  it("atividade a 1 minuto -> online (janela de 2min)", () => {
    expect(estaOnline(new Date(Date.now() - 60_000))).toBe(true);
  });

  it("atividade a 5 minutos -> offline", () => {
    expect(estaOnline(new Date(Date.now() - 5 * 60_000))).toBe(false);
  });
});

describe("whereMensagensNaoLidas (marca d'agua de nao-lidas)", () => {
  it("nunca leu (ultimaLeituraEm null) -> conta TODAS as mensagens nao apagadas, sem filtro de data", () => {
    expect(whereMensagensNaoLidas("conv-1", null)).toEqual({ conversaId: "conv-1", apagadoEm: null });
  });

  it("ja leu ate uma data -> so conta mensagens criadas DEPOIS dela", () => {
    const marca = new Date("2026-01-01T00:00:00Z");
    expect(whereMensagensNaoLidas("conv-1", marca)).toEqual({
      conversaId: "conv-1",
      apagadoEm: null,
      criadoEm: { gt: marca },
    });
  });
});

describe("resumoConteudo (preview da resposta citada / ultima mensagem)", () => {
  it("mensagem apagada -> rotulo fixo, nunca o conteudo real", () => {
    expect(resumoConteudo({ tipo: "texto", corpo: "segredo", apagadoEm: new Date() })).toBe("Mensagem apagada");
  });

  it("texto curto -> corpo integral", () => {
    expect(resumoConteudo({ tipo: "texto", corpo: "oi", apagadoEm: null })).toBe("oi");
  });

  it("texto longo (>80) -> truncado com reticencias", () => {
    const longo = "a".repeat(90);
    const resumo = resumoConteudo({ tipo: "texto", corpo: longo, apagadoEm: null });
    expect(resumo.endsWith("…")).toBe(true);
    expect(resumo.length).toBe(81);
  });

  it("foto/audio/localizacao/os_ref sem corpo -> rotulo do tipo", () => {
    expect(resumoConteudo({ tipo: "foto", corpo: null, apagadoEm: null })).toBe("📷 Foto");
    expect(resumoConteudo({ tipo: "audio", corpo: null, apagadoEm: null })).toBe("🎤 Áudio");
    expect(resumoConteudo({ tipo: "localizacao", corpo: null, apagadoEm: null })).toBe("📍 Localização");
    expect(resumoConteudo({ tipo: "os_ref", corpo: null, apagadoEm: null })).toBe("📋 Ordem de serviço");
  });

  it("mensagem de sistema sem corpo -> vazio (nao deveria acontecer, mas nao quebra)", () => {
    expect(resumoConteudo({ tipo: "sistema", corpo: null, apagadoEm: null })).toBe("");
  });
});

describe("resolverMencoes (extrai @nome e resolve pra participantes)", () => {
  const participantes = [
    { usuarioId: "u1", nome: "João Técnico" },
    { usuarioId: "u2", nome: "Maria Gestora" },
    { usuarioId: "u3", nome: "Admin Geral" },
  ];

  it("sem @ no corpo -> nenhuma mencao", () => {
    expect(resolverMencoes("oi pessoal, tudo bem?", participantes)).toEqual([]);
  });

  it("@primeironome bate case-insensitive", () => {
    expect(resolverMencoes("@joão pode verificar isso?", participantes)).toEqual(["u1"]);
  });

  it("@sobrenome tambem resolve (compara qualquer parte do nome)", () => {
    expect(resolverMencoes("cc @gestora", participantes)).toEqual(["u2"]);
  });

  it("duas mencoes na mesma mensagem -> as duas resolvidas, sem duplicar", () => {
    const ids = resolverMencoes("@joão e @maria, olhem isso", participantes).sort();
    expect(ids).toEqual(["u1", "u2"]);
  });

  it("@algo que nao bate com ninguem -> lista vazia (nao quebra)", () => {
    expect(resolverMencoes("@fulano-que-nao-existe", participantes)).toEqual([]);
  });
});

describe("validarMidia (limites de foto/audio validados no servidor)", () => {
  const fotoValida = Buffer.alloc(1024).toString("base64"); // 1KB, bem abaixo do limite

  it("foto sem anexoBase64/mime -> rejeita", () => {
    expect(() => validarMidia({ tipo: MensagemTipo.FOTO } as EnviarMensagemInput)).toThrow(/sem dados\/mime/);
  });

  it("foto com mime nao suportado -> rejeita", () => {
    expect(() =>
      validarMidia({ tipo: MensagemTipo.FOTO, anexoBase64: fotoValida, anexoMime: "image/gif" }),
    ).toThrow(/nao suportado/);
  });

  it("foto vazia (base64 que decodifica pra 0 bytes, ex.: so espacos) -> rejeita", () => {
    // "" e falsy e cairia no guard de "sem dados" antes — precisa de uma string
    // NAO-vazia (passa o !anexoBase64) que decodifique pra um buffer vazio.
    expect(() => validarMidia({ tipo: MensagemTipo.FOTO, anexoBase64: "   ", anexoMime: "image/jpeg" })).toThrow(/vazia/);
  });

  it("foto acima do limite de 400KB -> rejeita", () => {
    const grande = Buffer.alloc(LIMITE_FOTO_BYTES + 1).toString("base64");
    expect(() => validarMidia({ tipo: MensagemTipo.FOTO, anexoBase64: grande, anexoMime: "image/jpeg" })).toThrow(/maior que/);
  });

  it("foto valida dentro do limite -> aceita e devolve os bytes decodificados", () => {
    const resultado = validarMidia({ tipo: MensagemTipo.FOTO, anexoBase64: fotoValida, anexoMime: "image/jpeg" });
    expect(resultado.tamanho).toBe(1024);
    expect(resultado.dados).not.toBeNull();
  });

  it("audio acima de 60s -> rejeita mesmo com poucos bytes", () => {
    expect(() =>
      validarMidia({
        tipo: MensagemTipo.AUDIO,
        anexoBase64: fotoValida,
        anexoMime: "audio/m4a",
        duracaoSeg: LIMITE_AUDIO_SEG + 1,
      }),
    ).toThrow(/maior que 60s/);
  });

  it("audio acima do limite de 500KB -> rejeita", () => {
    const grande = Buffer.alloc(LIMITE_AUDIO_BYTES + 1).toString("base64");
    expect(() => validarMidia({ tipo: MensagemTipo.AUDIO, anexoBase64: grande, anexoMime: "audio/m4a" })).toThrow(/maior que/);
  });

  it("audio com mime nao suportado (ex.: mp3) -> rejeita", () => {
    expect(() => validarMidia({ tipo: MensagemTipo.AUDIO, anexoBase64: fotoValida, anexoMime: "audio/mp3" })).toThrow(
      /nao suportado/,
    );
  });

  it("texto/localizacao/sistema -> nao valida midia (sem anexo esperado)", () => {
    expect(validarMidia({ tipo: MensagemTipo.TEXTO, corpo: "oi" })).toEqual({ dados: null, tamanho: null });
    expect(validarMidia({ tipo: MensagemTipo.LOCALIZACAO, lat: 1, lng: 2 })).toEqual({ dados: null, tamanho: null });
  });
});
