import { useCallback, useEffect, useRef, useState } from "react";

type Theme = "light" | "dark";

const THEME_KEY = "app-theme";
const TOGGLE_DEBOUNCE_MS = 300;

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  const [isInitialized, setIsInitialized] = useState(false);
  const toggleTimeoutRef = useRef<number | null>(null);
  const lastToggleTimeRef = useRef<number>(0);

  // Инициализация темы при монтировании
  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme: Theme = savedTheme || (prefersDark ? "dark" : "light");

    setTheme(initialTheme);
    applyTheme(initialTheme);
    setIsInitialized(true);
  }, []);

  // Очистка таймера при размонтировании
  useEffect(() => {
    return () => {
      if (toggleTimeoutRef.current !== null) {
        clearTimeout(toggleTimeoutRef.current);
      }
    };
  }, []);

  // Применяем тему к DOM
  const applyTheme = (t: Theme) => {
    const root = document.documentElement;
    if (t === "dark") {
      root.classList.add("dark-mode");
    } else {
      root.classList.remove("dark-mode");
    }
  };

  // Переключаем тему с debounce
  const toggleTheme = useCallback(() => {
    const now = Date.now();
    
    // Отменяем предыдущий таймер если он есть
    if (toggleTimeoutRef.current !== null) {
      clearTimeout(toggleTimeoutRef.current);
    }

    // Проверяем минимальный интервал между переключениями
    if (now - lastToggleTimeRef.current < TOGGLE_DEBOUNCE_MS) {
      return;
    }

    lastToggleTimeRef.current = now;

    const newTheme: Theme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
  }, [theme]);

  return { theme, toggleTheme, isInitialized };
}
