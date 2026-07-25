import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const paraClaro = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={paraClaro ? "Mudar para tema claro" : "Mudar para tema escuro"}
      aria-label={paraClaro ? "Mudar para tema claro" : "Mudar para tema escuro"}
    >
      {paraClaro ? <Sun /> : <Moon />}
    </Button>
  );
}
