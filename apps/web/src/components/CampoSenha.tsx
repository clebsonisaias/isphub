import { useState } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CampoSenhaProps {
  id: string;
  label: string;
  valor: string;
  aoMudar: (valor: string) => void;
  /** "current-password" ao entrar; "new-password" ao criar/trocar. */
  autoComplete: "current-password" | "new-password";
  /** Texto de apoio permanente (ex.: regra de tamanho minimo). */
  ajuda?: string;
  autoFocus?: boolean;
  required?: boolean;
}

/**
 * Campo de senha usado no login, na redefinicao e na troca dentro do perfil.
 *
 * Extraido porque tres telas precisam do MESMO conjunto de detalhes, e um
 * deles so aparecer numa seria pior que nao existir em nenhuma:
 *
 *  - sem placeholder de bolinhas (`••••••••` e visualmente identico a um campo
 *    ja preenchido);
 *  - mostrar/ocultar com alvo de 44px e `aria-pressed`;
 *  - aviso de Caps Lock, a causa silenciosa mais comum de "a senha nao
 *    funciona" — e que o navegador nao denuncia sozinho num campo mascarado.
 */
export function CampoSenha({
  id,
  label,
  valor,
  aoMudar,
  autoComplete,
  ajuda,
  autoFocus,
  required = true,
}: CampoSenhaProps) {
  const [visivel, setVisivel] = useState(false);
  const [capsLigado, setCapsLigado] = useState(false);

  function checarCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLigado(e.getModifierState?.("CapsLock") ?? false);
  }

  const idAjuda = ajuda ? `${id}-ajuda` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visivel ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required={required}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          onKeyDown={checarCaps}
          onKeyUp={checarCaps}
          onBlur={() => setCapsLigado(false)}
          aria-describedby={idAjuda}
          className="h-11 pr-12"
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          // Alvo de 44px de largura total, mesmo com o icone de 18px.
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={visivel}
          aria-controls={id}
        >
          {visivel ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
        </button>
      </div>
      {ajuda && (
        <p id={idAjuda} className="text-xs text-muted-foreground">
          {ajuda}
        </p>
      )}
      {capsLigado && (
        <p className="flex items-center gap-1.5 text-xs text-warning" role="status">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          Caps Lock está ligado.
        </p>
      )}
    </div>
  );
}
