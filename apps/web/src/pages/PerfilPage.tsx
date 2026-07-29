import { useEffect, useRef, useState, type FormEvent } from "react";
import { STATUS_PRESET_LABEL, StatusPreset, USER_ROLE_LABEL } from "@isphub/shared";
import { AppShell } from "@/components/AppShell";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/lib/authApi";
import { api, ApiError } from "@/lib/apiClient";
import { useToast } from "@/context/ToastContext";
import { Camera, KeyRound, X } from "lucide-react";

function mensagem(err: unknown): string {
  return err instanceof ApiError ? err.message : "Falha ao comunicar com o servidor";
}

const STATUS_OPCOES = Object.values(StatusPreset);

/** Corta quadrado (centro) e comprime — mesmo alvo do mobile (comprimirAvatar): 320x320 JPEG q0.7. */
function comprimirAvatar(arquivo: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const lado = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 320;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas indisponível"));
      ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 320, 320);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      resolve({ base64: dataUrl.split(",")[1] ?? "", mime: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem"));
    };
    img.src = url;
  });
}

export function PerfilPage() {
  const { usuario, refetchMe } = useAuth();
  const { toast } = useToast();
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [enviandoSenha, setEnviandoSenha] = useState(false);

  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const inputFotoRef = useRef<HTMLInputElement>(null);

  const [statusLocal, setStatusLocal] = useState<StatusPreset | null>(usuario?.status ?? null);
  const [statusTextoLocal, setStatusTextoLocal] = useState(usuario?.statusTexto ?? "");
  const [salvandoStatus, setSalvandoStatus] = useState(false);

  const [nomeExibicao, setNomeExibicao] = useState(usuario?.nomeExibicao ?? "");
  const [bio, setBio] = useState(usuario?.bio ?? "");
  const [telefoneContato, setTelefoneContato] = useState(usuario?.telefoneContato ?? "");
  const [assinaturaChat, setAssinaturaChat] = useState(usuario?.assinaturaChat ?? "");
  const [corDestaque, setCorDestaque] = useState(usuario?.corDestaque ?? "");
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);

  useEffect(() => {
    let vivo = true;
    let url: string | null = null;
    if (usuario?.temFoto) {
      api
        .getBlob(`/auth/foto/${usuario.id}?v=${usuario.fotoVersao}`)
        .then((blob) => {
          if (!vivo) return;
          url = URL.createObjectURL(blob);
          setFotoUrl(url);
        })
        .catch(() => vivo && setFotoUrl(null));
    } else {
      setFotoUrl(null);
    }
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id, usuario?.temFoto, usuario?.fotoVersao]);

  if (!usuario) return null;

  async function handleTrocarSenha(e: FormEvent) {
    e.preventDefault();
    if (novaSenha !== confirmarSenha) {
      toast({ titulo: "As senhas não coincidem", variante: "erro" });
      return;
    }
    setEnviandoSenha(true);
    try {
      await authApi.trocarSenha(senhaAtual, novaSenha);
      toast({ titulo: "Senha alterada com sucesso", variante: "sucesso" });
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmarSenha("");
    } catch (err) {
      toast({ titulo: "Erro ao trocar senha", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviandoSenha(false);
    }
  }

  async function handleEscolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setEnviandoFoto(true);
    try {
      const { base64, mime } = await comprimirAvatar(arquivo);
      await authApi.enviarFoto(base64, mime);
      await refetchMe();
      toast({ titulo: "Foto atualizada", variante: "sucesso" });
    } catch (err) {
      toast({ titulo: "Não foi possível enviar a foto", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function handleRemoverFoto() {
    setEnviandoFoto(true);
    try {
      await authApi.removerFoto();
      await refetchMe();
    } catch (err) {
      toast({ titulo: "Não foi possível remover a foto", descricao: mensagem(err), variante: "erro" });
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function handleSalvarStatus() {
    setSalvandoStatus(true);
    try {
      await authApi.atualizarStatus(statusLocal, statusTextoLocal.trim() || null);
      await refetchMe();
      toast({ titulo: "Status atualizado", variante: "sucesso" });
    } catch (err) {
      toast({ titulo: "Não foi possível atualizar o status", descricao: mensagem(err), variante: "erro" });
    } finally {
      setSalvandoStatus(false);
    }
  }

  async function handleSalvarPerfil(e: FormEvent) {
    e.preventDefault();
    if (corDestaque && !/^#[0-9a-fA-F]{6}$/.test(corDestaque)) {
      toast({ titulo: "Cor inválida", descricao: "Use o formato #rrggbb", variante: "erro" });
      return;
    }
    setSalvandoPerfil(true);
    try {
      await authApi.atualizarPerfil({
        nomeExibicao: nomeExibicao.trim() || null,
        bio: bio.trim() || null,
        telefoneContato: telefoneContato.trim() || null,
        assinaturaChat: assinaturaChat.trim() || null,
        corDestaque: corDestaque.trim() || null,
      });
      await refetchMe();
      toast({ titulo: "Perfil atualizado", variante: "sucesso" });
    } catch (err) {
      toast({ titulo: "Não foi possível salvar o perfil", descricao: mensagem(err), variante: "erro" });
    } finally {
      setSalvandoPerfil(false);
    }
  }

  return (
    <AppShell>
      <AnimatedPage>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Meu perfil</h1>
        <p className="text-sm text-muted-foreground">
          {usuario.nome} · {usuario.email} · {USER_ROLE_LABEL[usuario.role]}
        </p>
      </div>

      <div className="flex flex-col gap-6 max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Foto e status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => inputFotoRef.current?.click()}
                  disabled={enviandoFoto}
                  className="size-16 overflow-hidden rounded-full border border-border bg-secondary/40 flex items-center justify-center"
                >
                  {fotoUrl ? (
                    <img src={fotoUrl} alt="Sua foto" className="size-full object-cover" />
                  ) : (
                    <span className="text-lg font-semibold text-muted-foreground">
                      {usuario.nome.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </button>
                <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border border-border bg-card">
                  <Camera className="size-3.5" />
                </span>
                <input ref={inputFotoRef} type="file" accept="image/*" className="hidden" onChange={handleEscolherFoto} />
              </div>
              <div className="flex flex-col gap-1">
                <Button type="button" variant="outline" size="sm" onClick={() => inputFotoRef.current?.click()} disabled={enviandoFoto}>
                  {enviandoFoto ? "Enviando..." : "Trocar foto"}
                </Button>
                {usuario.temFoto && (
                  <Button type="button" variant="ghost" size="sm" onClick={handleRemoverFoto} disabled={enviandoFoto}>
                    <X className="size-3.5" /> Remover
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Status</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-fit justify-start">
                    {statusLocal ? STATUS_PRESET_LABEL[statusLocal] : "Definir status"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {STATUS_OPCOES.map((opcao) => (
                        <button
                          key={opcao}
                          type="button"
                          onClick={() => setStatusLocal(statusLocal === opcao ? null : opcao)}
                          className={
                            "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                            (statusLocal === opcao
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-secondary/60")
                          }
                        >
                          {STATUS_PRESET_LABEL[opcao]}
                        </button>
                      ))}
                    </div>
                    <Input
                      placeholder="Complemento opcional"
                      value={statusTextoLocal}
                      onChange={(e) => setStatusTextoLocal(e.target.value)}
                      maxLength={140}
                    />
                    <Button type="button" variant="brand" size="sm" onClick={handleSalvarStatus} disabled={salvandoStatus}>
                      {salvandoStatus ? "Salvando..." : "Salvar status"}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sobre mim</CardTitle>
            <CardDescription>Essas informações aparecem pra outros colegas no chat.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSalvarPerfil} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="nomeExibicao">Nome de exibição</Label>
                <Input id="nomeExibicao" value={nomeExibicao} onChange={(e) => setNomeExibicao(e.target.value)} maxLength={80} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} rows={3} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="telefoneContato">Telefone de contato</Label>
                <Input id="telefoneContato" value={telefoneContato} onChange={(e) => setTelefoneContato(e.target.value)} maxLength={30} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="assinaturaChat">Assinatura do chat</Label>
                <Input id="assinaturaChat" value={assinaturaChat} onChange={(e) => setAssinaturaChat(e.target.value)} maxLength={140} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="corDestaque">Cor de destaque</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="corDestaque"
                    value={corDestaque}
                    onChange={(e) => setCorDestaque(e.target.value)}
                    placeholder="#6366f1"
                    maxLength={7}
                    className="w-32"
                  />
                  {corDestaque && /^#[0-9a-fA-F]{6}$/.test(corDestaque) && (
                    <span className="size-6 rounded-full border border-border" style={{ backgroundColor: corDestaque }} />
                  )}
                </div>
              </div>
              <Button type="submit" variant="brand" className="w-fit" disabled={salvandoPerfil}>
                {salvandoPerfil ? "Salvando..." : "Salvar perfil"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trocar senha</CardTitle>
            <CardDescription>Você precisa da sua senha atual para definir uma nova.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleTrocarSenha} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="senhaAtual">Senha atual</Label>
                <Input
                  id="senhaAtual"
                  type="password"
                  required
                  value={senhaAtual}
                  onChange={(e) => setSenhaAtual(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="novaSenha">Nova senha</Label>
                <Input
                  id="novaSenha"
                  type="password"
                  required
                  minLength={8}
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmarSenha">Confirmar nova senha</Label>
                <Input
                  id="confirmarSenha"
                  type="password"
                  required
                  minLength={8}
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                variant="brand"
                className="w-fit"
                disabled={enviandoSenha || !senhaAtual || novaSenha.length < 8}
              >
                <KeyRound className="size-3.5" />
                {enviandoSenha ? "Salvando..." : "Trocar senha"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      </AnimatedPage>
    </AppShell>
  );
}
